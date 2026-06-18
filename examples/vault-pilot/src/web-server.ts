/**
 * Web server pilot — enterprise vault agent accessible from the browser
 *
 * Run:  npm run web
 * Then: open packages/web/client/index.html in the browser
 *       connect to ws://localhost:3000/chat
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
import { DeepSeekProvider } from './providers/DeepSeekProvider';

// ── Config ───────────────────────────────────────────────────────────────────

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? '';
const LLM_MODEL        = process.env.LLM_MODEL ?? 'deepseek-chat';
const VAULT_PATH       = process.env.VAULT_PATH ?? path.resolve(__dirname, '../vault');
const INDEX_PATH       = path.join(os.homedir(), '.bk-agent', 'rag', 'enterprise-vault.json');
const PORT             = parseInt(process.env.PORT ?? '3000', 10);

// ── Agent profiles ────────────────────────────────────────────────────────────

const CONSULTANT: AgentProfile = {
    id: 'consultant',
    name: 'Enterprise Consultant',
    icon: '◆',
    description: 'Answers questions using the shared enterprise vault.',
    systemPrompt: `You are an enterprise consultant for the BackendKit Agent Framework team.

Before answering any question:
1. Search the vault with search_knowledge to find relevant context.
2. Base your answer on what you find — cite the source note title.
3. If you learn something new or resolve a gap, write it to the vault with write_knowledge.

Be concise and practical. Prefer concrete examples over theory.`,
    allowedTools: ['search_knowledge', 'write_knowledge'],
};

const ANALYST: AgentProfile = {
    id: 'analyst',
    name: 'Technical Analyst',
    icon: '🔬',
    description: 'Deep technical analysis and documentation.',
    systemPrompt: `You are a senior technical analyst for the BackendKit Agent Framework team.

Your job:
1. Search the vault for existing context on the topic.
2. Analyse the problem thoroughly.
3. Document your findings as a new note in the vault with write_knowledge.
4. Summarise what you found and what you wrote.`,
    allowedTools: ['search_knowledge', 'write_knowledge'],
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    if (!DEEPSEEK_API_KEY) {
        console.error('✗  DEEPSEEK_API_KEY is required. Add it to pilot/.env');
        process.exit(1);
    }

    // ── Shared resources — created once, reused across sessions ─────────────

    const rag = new ObsidianRAGProvider({
        vaultPath: VAULT_PATH,
        indexPath: INDEX_PATH,
        embedder: new SimpleEmbedder(),
        topK: 5,
        minScore: 0.1,
    });

    const writer = new VaultWriter({ vaultPath: VAULT_PATH });

    console.log('Indexing vault…');
    const { indexed, removed } = await rag.index({ verbose: false });
    console.log(`✓  Vault: ${indexed} new chunks, ${removed} removed.\n`);

    // ── Engine factory — one engine per WebSocket session ───────────────────

    const engineFactory: EngineFactory = (sessionId, transport) => {
        const tools = new ToolRegistry();
        tools.register(rag.createTool());
        tools.register(writer.createTool(CONSULTANT.id));

        const memory = createMemorySystem({
            episodic:   { provider: 'json', path: path.join(os.homedir(), '.bk-agent', 'sessions', sessionId, 'ep.json') },
            semantic:   { provider: 'json', path: path.join(os.homedir(), '.bk-agent', 'sessions', sessionId, 'sem.json') },
            procedural: { provider: 'json', path: path.join(os.homedir(), '.bk-agent', 'sessions', sessionId, 'proc.json') },
            retention:  { maxEpisodes: 100 },
        });

        const agents = new AgentRegistry();
        agents.register(CONSULTANT);
        agents.register(ANALYST);

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

    // ── Start server ──────────────────────────────────────────────────────────

    const server = new AgentServer({
        port: PORT,
        host: '0.0.0.0',
        engineFactory,
        logger: true,
        cors: '*',
    });

    const address = await server.start();

    const clientPath = path.resolve(__dirname, '../../packages/web/client/index.html');

    console.log(`✓  Agent server: ${address}`);
    console.log(`✓  WebSocket:    ws://localhost:${PORT}/chat`);
    console.log(`\n   Open this file in your browser:`);
    console.log(`   ${clientPath}`);
    console.log(`\n   Then connect to: ws://localhost:${PORT}/chat\n`);

    for (const sig of ['SIGINT', 'SIGTERM'] as const) {
        process.on(sig, async () => {
            console.log('\nShutting down…');
            await server.stop();
            process.exit(0);
        });
    }
}

main().catch((err) => {
    console.error('Server error:', err);
    process.exit(1);
});
