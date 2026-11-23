import * as os from 'os';
import * as path from 'path';
import {
    AgentEngine,
    AgentRegistry,
    ToolRegistry,
    ProviderRegistry,
    CallbackTransport,
    createMemorySystem,
    selfAssertedIdentities,
} from '@backendkit-labs/agent-core';
import { OllamaProvider } from '@backendkit-labs/agent-coding';
import { ObsidianRAGProvider, VaultWriter } from '@backendkit-labs/agent-enterprise';
import { loadConfig } from './config';
import { ORCHESTRATOR_PROFILE } from './agents/orchestrator';
import { DOMAIN_SPECIALIST_PROFILE } from './agents/domain-specialist';
import { exampleAction } from './tools/example-tools';

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

    // ── Knowledge base (RAG) ──────────────────────────────────────────────────
    // Indexes the Obsidian vault on first use. Subsequent runs are incremental
    // (only re-embeds new or modified files).
    const rag = new ObsidianRAGProvider({
        vaultPath:      config.vaultPath,
        ollamaHost:     config.ollamaHost,
        embeddingModel: config.embeddingModel,
        // TODO: restrict indexing to specific folders:
        // folders: ['01-Procesos', '02-Politicas', '04-FAQs'],
    });

    // ── Vault write-back ──────────────────────────────────────────────────────
    // Agents can contribute new knowledge back to the vault (write_knowledge tool).
    // Notes land in <vaultPath>/agentes/ and are searchable on next index().
    const writer = new VaultWriter({ vaultPath: config.vaultPath });

    // ── Tools ─────────────────────────────────────────────────────────────────
    const tools = new ToolRegistry();
    tools
        .register(rag.createTool())              // search_knowledge — semantic search
        .register(writer.createTool('specialist')) // write_knowledge — agent write-back
        .register(exampleAction);
    for (const t of memory.getTools()) tools.register(t);
    // TODO: register business-specific tools (CRM, ticketing system, internal APIs)

    // ── Agents ────────────────────────────────────────────────────────────────
    const agents = new AgentRegistry();
    agents
        .register(ORCHESTRATOR_PROFILE)
        .register(DOMAIN_SPECIALIST_PROFILE);
    // TODO: add more specialists for each business domain

    // ── LLM Provider (local via Ollama) ───────────────────────────────────────
    const providers = new ProviderRegistry();
    providers.register('default', new OllamaProvider({
        host:  config.ollamaHost,
        model: config.ollamaModel,
    }));

    return new AgentEngine({
        // Who this agent is, and on whose behalf it acts (both are required). Swap `selfAssertedIdentities()` for your identity provider's.
        agentIdentity: selfAssertedIdentities(),
        identity: { userId: process.env.USERNAME ?? process.env.USER ?? 'me' },
        model:              { provider: 'default', id: config.ollamaModel },
        agents,
        tools,
        providers,
        defaultProvider:    'default',
        defaultAgentId:     'orchestrator',
        transport,
        maxIterations:      30,
        iterationMode:      'auto',
        historyPath:        HISTORY,
        maxContextMessages: 100,
        memorySystem:       memory,
        additionalRoots:    [APP_DIR],
    });
}
