/**
 * Smoke test — verifies vault indexing, RAG search, and one real LLM call.
 * Non-interactive: runs and exits.
 *
 * Run: DEEPSEEK_API_KEY=<key> npx tsx src/smoke-test.ts
 */

import 'dotenv/config';
import * as path from 'path';
import * as os from 'os';
import {
    AgentEngine,
    AgentRegistry,
    ToolRegistry,
    ProviderRegistry,
    CallbackTransport,
} from '@backendkit-labs/agent-core';
import type { AgentProfile, AgentEvent } from '@backendkit-labs/agent-core';
import { ObsidianRAGProvider, VaultWriter, SimpleEmbedder } from '@backendkit-labs/agent-enterprise';
import { DeepSeekProvider } from './providers/DeepSeekProvider';

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? '';
const VAULT_PATH       = process.env.VAULT_PATH ?? path.resolve(__dirname, '../vault');
const INDEX_PATH       = path.join(os.homedir(), '.bk-agent', 'rag', 'smoke-test.json');

async function main(): Promise<void> {
    if (!DEEPSEEK_API_KEY) {
        console.error('✗  DEEPSEEK_API_KEY required');
        process.exit(1);
    }

    console.log('BackendKit Enterprise — Smoke Test');
    console.log(`Vault: ${VAULT_PATH}\n`);

    // ── 1. Index vault ────────────────────────────────────────────────────────
    process.stdout.write('[1/3] Indexing vault... ');
    const rag = new ObsidianRAGProvider({
        vaultPath: VAULT_PATH,
        indexPath:  INDEX_PATH,
        embedder:   new SimpleEmbedder(),
        topK:       3,
        minScore:   0.1,
    });
    const { indexed } = await rag.index({ verbose: false });
    console.log(`${indexed} chunks indexed ✓`);

    // ── 2. RAG search ─────────────────────────────────────────────────────────
    process.stdout.write('[2/3] RAG search ("cuando usar multiples agentes")... ');
    const result = await rag.search('cuando usar multiples agentes');
    if (!result || result.trim() === '' || result.includes('No relevant')) {
        console.log('✗  No results — check vault path or minScore');
        process.exit(1);
    }
    console.log('results found ✓');
    console.log('     ' + result.slice(0, 120).replace(/\n/g, ' '));

    // ── 3. LLM call through engine ────────────────────────────────────────────
    console.log('\n[3/3] LLM call through engine...');

    const PROFILE: AgentProfile = {
        id: 'consultant',
        name: 'Enterprise Consultant',
        icon: '◆',
        description: 'Enterprise agent consultant using the shared vault.',
        systemPrompt: 'You are an enterprise agent consultant. Search the vault before answering.',
        allowedTools: ['search_knowledge', 'write_knowledge'],
    };

    const tools    = new ToolRegistry();
    tools.register(rag.createTool());
    tools.register(new VaultWriter({ vaultPath: VAULT_PATH }).createTool('smoke-test'));

    const agents   = new AgentRegistry();
    agents.register(PROFILE);

    const providers = new ProviderRegistry();
    providers.register('deepseek', new DeepSeekProvider({ apiKey: DEEPSEEK_API_KEY }));

    let output = '';
    const transport = new CallbackTransport((evt: AgentEvent) => {
        if (evt.type === 'token')       { process.stdout.write(evt.content); output += evt.content; }
        if (evt.type === 'tool_call')   { process.stdout.write(`\n  [${evt.name}] `); }
        if (evt.type === 'tool_result') { process.stdout.write(evt.success ? '✓' : '✗'); }
    });

    const engine = new AgentEngine({
        model:           { provider: 'deepseek', id: 'deepseek-chat' },
        agents, tools, providers,
        defaultProvider: 'deepseek',
        defaultAgentId:  'consultant',
        transport,
        maxIterations:   5,
        iterationMode:   'auto',
    });

    process.stdout.write('\nQ: ¿Cuándo conviene usar múltiples agentes?\n\n');
    await engine.run('¿Cuándo conviene usar múltiples agentes en un proyecto enterprise?');

    console.log('\n\n──────────────────────────────────────');
    console.log('✓  Smoke test passed. REPL is ready.');
    console.log('   Run: npm run repl');
}

main().catch(err => { console.error('\n✗ ', err.message); process.exit(1); });
