/**
 * Example: enterprise agent server with vault RAG
 *
 * Run:
 *   DEEPSEEK_API_KEY=sk-xxx npx tsx example/server.ts
 *
 * Then open client/index.html in the browser and connect to ws://localhost:3000/chat
 */

import 'dotenv/config';
import * as path from 'path';
import * as os from 'os';
import {
    AgentEngine,
    AgentRegistry,
    ToolRegistry,
    ProviderRegistry,
    createMemorySystem,
} from '@backendkit-labs/agent-core';
import type { AgentProfile } from '@backendkit-labs/agent-core';
import { ObsidianRAGProvider, VaultWriter, SimpleEmbedder } from '@backendkit-labs/agent-enterprise';
import { AgentServer } from '@backendkit-labs/agent-web';
import type { EngineFactory } from '@backendkit-labs/agent-web';

// ── Config ──────────────────────────────────────────────────────────────────

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? '';
const LLM_MODEL        = process.env.LLM_MODEL ?? 'deepseek-chat';
const VAULT_PATH       = process.env.VAULT_PATH ?? path.resolve(__dirname, '../../pilot/vault');
const INDEX_PATH       = path.join(os.homedir(), '.bk-agent', 'rag', 'enterprise-vault.json');
const PORT             = parseInt(process.env.PORT ?? '3000', 10);

if (!DEEPSEEK_API_KEY) {
    console.error('DEEPSEEK_API_KEY is required');
    process.exit(1);
}

// ── Shared resources (created once, reused across all sessions) ──────────────

const embedder = new SimpleEmbedder();

const rag = new ObsidianRAGProvider({
    vaultPath: VAULT_PATH,
    indexPath: INDEX_PATH,
    embedder,
    topK: 5,
    minScore: 0.1,
});

const writer = new VaultWriter({ vaultPath: VAULT_PATH });

// Index vault on startup
await rag.index({ verbose: true }).then(({ indexed, removed }) => {
    console.log(`Vault indexed: ${indexed} new chunks, ${removed} removed.`);
});

// ── Agent profiles ───────────────────────────────────────────────────────────

const CONSULTANT_PROFILE: AgentProfile = {
    id: 'consultant',
    name: 'Enterprise Consultant',
    icon: '◆',
    description: 'Answers questions using the shared enterprise vault.',
    systemPrompt: `You are an enterprise consultant with deep knowledge of this company.
Always search the vault first with search_knowledge before answering.
Cite the source note when referencing internal documentation.`,
    allowedTools: ['search_knowledge', 'write_knowledge'],
};

// ── Provider (shared, thread-safe) ──────────────────────────────────────────

// Lazy-import the pilot DeepSeekProvider
// In production use @backendkit-labs/agent-coding OpenAICompatibleProvider
const { DeepSeekProvider } = await import('../../pilot/src/providers/DeepSeekProvider.js');

// ── Engine factory — one engine per session ───────────────────────────────────

const engineFactory: EngineFactory = (sessionId, transport) => {
    const tools = new ToolRegistry();
    tools.register(rag.createTool());
    tools.register(writer.createTool('consultant'));

    const memory = createMemorySystem({
        episodic:   { provider: 'json', path: path.join(os.homedir(), '.bk-agent', 'sessions', sessionId, 'episodes.json') },
        semantic:   { provider: 'json', path: path.join(os.homedir(), '.bk-agent', 'sessions', sessionId, 'knowledge.json') },
        procedural: { provider: 'json', path: path.join(os.homedir(), '.bk-agent', 'sessions', sessionId, 'patterns.json') },
        retention:  { maxEpisodes: 100 },
    });

    const agents = new AgentRegistry();
    agents.register(CONSULTANT_PROFILE);

    const providers = new ProviderRegistry();
    providers.register('deepseek', new DeepSeekProvider({ apiKey: DEEPSEEK_API_KEY, model: LLM_MODEL }));

    return new AgentEngine({
        model:           { provider: 'deepseek', id: LLM_MODEL },
        agents,
        tools,
        providers,
        defaultProvider: 'deepseek',
        defaultAgentId:  'consultant',
        transport,
        maxIterations:   20,
        iterationMode:   'auto',
        memorySystem:    memory,
        sessionId,
    });
};

// ── Server ────────────────────────────────────────────────────────────────────

const server = new AgentServer({
    port: PORT,
    engineFactory,
    logger: true,
    cors: '*',
});

const address = await server.start();
console.log(`\nAgent server running at ${address}`);
console.log(`Open client/index.html and connect to ws://localhost:${PORT}/chat\n`);

// Graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
        console.log(`\nShutting down (${sig})…`);
        await server.stop();
        process.exit(0);
    });
}
