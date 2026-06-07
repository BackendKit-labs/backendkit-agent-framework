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
import { MY_AGENT_PROFILE } from './agents/my-agent';
import { exampleAction, exampleQuery } from './tools/example-tools';

// ── Persistent storage paths ──────────────────────────────────────────────────

const APP_DIR = path.join(os.homedir(), '.my-agent');
const HISTORY = path.join(APP_DIR, 'history.json');
const MEM_DIR = path.join(APP_DIR, 'memory');

// ── Memory system ─────────────────────────────────────────────────────────────

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
    for (const t of memory.getTools()) tools.register(t);
    // TODO: register more tools

    const agents = new AgentRegistry();
    agents.register(MY_AGENT_PROFILE);
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
        defaultAgentId:   'my-agent',
        transport,
        maxIterations:    20,
        iterationMode:    'auto',
        historyPath:      HISTORY,
        maxContextMessages: 100,
        memorySystem:     memory,
    });
}
