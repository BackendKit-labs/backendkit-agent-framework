import * as os from 'os';
import * as path from 'path';
import {
    AgentEngine,
    AgentRegistry,
    ToolRegistry,
    ProviderRegistry,
    CallbackTransport,
    createMemorySystem,
} from '@backendkit-labs/agent-core';
import { OpenAICompatibleProvider } from './providers/openai-compatible';
import { loadConfig } from './config';
import { ORCHESTRATOR_PROFILE } from './agents/orchestrator';
import { SPECIALIST_A_PROFILE } from './agents/specialist-a';
import { SPECIALIST_B_PROFILE } from './agents/specialist-b';
import { exampleAction, exampleQuery } from './tools/example-tools';

// ── Persistent storage paths ──────────────────────────────────────────────────
// All state lives in ~/.my-agent/ so it survives restarts.

const APP_DIR    = path.join(os.homedir(), '.my-agent');
const HISTORY    = path.join(APP_DIR, 'history.json');
const MEM_DIR    = path.join(APP_DIR, 'memory');

// ── Memory system ─────────────────────────────────────────────────────────────
// Three-tier: episodic (past experiences) + semantic (knowledge) + procedural (patterns).
// buildContextBlock() auto-injects relevant memories into each agent turn.

const memory = createMemorySystem({
    episodic:   { provider: 'json', path: path.join(MEM_DIR, 'episodes.json') },
    semantic:   { provider: 'json', path: path.join(MEM_DIR, 'knowledge.json') },
    procedural: { provider: 'json', path: path.join(MEM_DIR, 'patterns.json') },
    retention:  { maxEpisodes: 500 },
});

export function createEngine(transport: CallbackTransport): AgentEngine {
    const config = loadConfig();

    const tools = new ToolRegistry();
    tools
        .register(exampleAction)
        .register(exampleQuery);
    // Register memory tools so agents can explicitly save/recall memories
    for (const t of memory.getTools()) tools.register(t);
    // TODO: register more tools

    const agents = new AgentRegistry();
    agents
        .register(ORCHESTRATOR_PROFILE)
        .register(SPECIALIST_A_PROFILE)
        .register(SPECIALIST_B_PROFILE);
    // TODO: register more specialists

    const providers = new ProviderRegistry();
    providers.register('default', new OpenAICompatibleProvider({
        apiKey:  config.llmApiKey,
        baseUrl: config.llmBaseUrl,
        model:   config.llmModel,
    }));

    return new AgentEngine({
        model:            { provider: 'default', id: config.llmModel },
        agents,
        tools,
        providers,
        defaultProvider:  'default',
        defaultAgentId:   'orchestrator',
        transport,
        maxIterations:    30,
        iterationMode:    'auto',
        // Conversation history — persists between runs
        historyPath:      HISTORY,
        maxContextMessages: 100,
        // Long-term memory — injects relevant context each turn
        memorySystem:     memory,
        additionalRoots:  [APP_DIR],
    });
}

// ── Skill pack: node ──────────────────────────────────────────────────────
// npm, jest, tsc, eslint — Node.js / TypeScript conventions
// To activate: add YAML skill files in .backendkit-agent/skills/
// and wire SkillLoader + SkillActivator into the engine above.
