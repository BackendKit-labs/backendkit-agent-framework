/**
 * Enterprise Vault REPL
 *
 * Interactive CLI that connects to a shared Markdown vault and lets you
 * converse with an enterprise consultant agent. The agent searches the vault
 * for context before every response and writes back learnings as new notes.
 *
 * Run:   DEEPSEEK_API_KEY=<key> npm run repl
 *        DEEPSEEK_API_KEY=<key> VAULT_PATH=/path/to/vault npm run repl
 */

import * as readline from 'readline';
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

// ── Config ────────────────────────────────────────────────────────────────────

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? '';
const LLM_MODEL        = process.env.LLM_MODEL ?? 'deepseek-chat';
const VAULT_PATH       = process.env.VAULT_PATH
    ?? path.resolve(__dirname, '../../vault');
const INDEX_PATH       = path.join(os.homedir(), '.bk-agent', 'rag', 'enterprise-vault.json');

// ── Agent profiles ────────────────────────────────────────────────────────────

const CONSULTANT_PROFILE: AgentProfile = {
    id: 'consultant',
    name: 'Enterprise Consultant',
    icon: '◆',
    description: 'Answers questions about enterprise agent architecture using the shared vault as knowledge base.',
    systemPrompt: `You are a senior enterprise consultant specializing in AI agent systems built with the BackendKit Agent Framework.

Your knowledge base is the shared vault — search it before every response using search_knowledge.
If you find relevant information, cite the note title in your response.
If the query involves a decision, pattern, or lesson not yet documented, write it back
to the vault using write_knowledge so the team benefits from it going forward.

Guidelines:
- Always call search_knowledge first, even for simple questions
- Cite sources: "According to the vault note 'Decisión: Estrategia de proveedores LLM'..."
- If the vault has no relevant context, say so before answering from general knowledge
- Write back findings that are worth documenting: new patterns, edge cases, decisions`,
    allowedTools: ['search_knowledge', 'write_knowledge'],
};

const ANALYST_PROFILE: AgentProfile = {
    id: 'analyst',
    name: 'Technical Analyst',
    icon: '🔬',
    description: 'Analyses technical problems in depth and always documents findings in the vault.',
    systemPrompt: `You are a technical analyst for enterprise AI agent projects.

Your job:
1. Search the vault for existing context using search_knowledge
2. Reason deeply about the problem
3. Write your analysis and conclusions to the vault using write_knowledge
4. Summarise your findings concisely

Always search before writing. Structure your vault notes with ## headings.
Your notes become shared knowledge — write as if a colleague will read them.`,
    allowedTools: ['search_knowledge', 'write_knowledge'],
};

// ── REPL ──────────────────────────────────────────────────────────────────────

const COMMANDS: Record<string, string> = {
    '/help':    'Show available commands',
    '/clear':   'Clear conversation history',
    '/reindex': 'Re-index the vault (picks up new notes)',
    '/agent consultant': 'Switch to Consultant agent (search + write)',
    '/agent analyst':    'Switch to Analyst agent (deep analysis + write)',
    '/quit':    'Exit',
};

function printHelp(): void {
    console.log('\nAvailable commands:');
    for (const [cmd, desc] of Object.entries(COMMANDS)) {
        console.log(`  ${cmd.padEnd(22)} ${desc}`);
    }
    console.log('');
}

function printBanner(vaultPath: string): void {
    console.log('');
    console.log('  BackendKit Enterprise Vault REPL');
    console.log('  ─────────────────────────────────────────────────');
    console.log(`  Vault:    ${vaultPath}`);
    console.log(`  LLM:      DeepSeek ${LLM_MODEL}`);
    console.log(`  Embedder: SimpleEmbedder (local, no Ollama required)`);
    console.log('  ─────────────────────────────────────────────────');
    console.log('  Type a question or /help for commands.\n');
}

async function main(): Promise<void> {
    if (!DEEPSEEK_API_KEY) {
        console.error('✗  DEEPSEEK_API_KEY is required. Add it to .env or set it in the shell.');
        process.exit(1);
    }

    printBanner(VAULT_PATH);

    // ── RAG + Writer ──────────────────────────────────────────────────────────
    const embedder = new SimpleEmbedder();
    const rag = new ObsidianRAGProvider({
        vaultPath: VAULT_PATH,
        indexPath:  INDEX_PATH,
        embedder,
        topK:      5,
        minScore:  0.1,
    });

    const writer = new VaultWriter({ vaultPath: VAULT_PATH });

    process.stdout.write('  Indexing vault... ');
    const { indexed, removed } = await rag.index({ verbose: false });
    console.log(`${indexed} chunks indexed, ${removed} removed.\n`);

    // ── Tools ─────────────────────────────────────────────────────────────────
    const tools = new ToolRegistry();
    tools.register(rag.createTool());
    tools.register(writer.createTool('consultant'));

    // ── Agents ────────────────────────────────────────────────────────────────
    const agents = new AgentRegistry();
    agents.register(CONSULTANT_PROFILE);
    agents.register(ANALYST_PROFILE);

    // ── Provider ──────────────────────────────────────────────────────────────
    const providers = new ProviderRegistry();
    providers.register('deepseek', new DeepSeekProvider({ apiKey: DEEPSEEK_API_KEY, model: LLM_MODEL }));

    // ── Transport ─────────────────────────────────────────────────────────────
    let currentAgentId = 'consultant';

    const transport = new CallbackTransport((evt: AgentEvent) => {
        switch (evt.type) {
            case 'token':
                process.stdout.write(evt.content);
                break;
            case 'tool_call': {
                const preview = evt.args_preview ? ` ${evt.args_preview.slice(0, 80)}` : '';
                console.log(`\n  [${evt.name}]${preview}`);
                break;
            }
            case 'tool_result': {
                const preview = (evt.preview ?? '').slice(0, 100).replace(/\n/g, ' ');
                const status  = evt.success ? '✓' : '✗';
                console.log(`  ${status} ${preview}`);
                break;
            }
            case 'agent_switch':
                currentAgentId = evt.to ?? currentAgentId;
                break;
        }
    });

    // ── Engine ────────────────────────────────────────────────────────────────
    const engine = new AgentEngine({
        model:           { provider: 'deepseek', id: LLM_MODEL },
        agents,
        tools,
        providers,
        defaultProvider: 'deepseek',
        defaultAgentId:  'consultant',
        transport,
        maxIterations:   20,
        iterationMode:   'auto',
    });

    // ── readline loop ─────────────────────────────────────────────────────────
    const rl = readline.createInterface({
        input:  process.stdin,
        output: process.stdout,
        terminal: true,
    });

    const prompt = (): void => {
        const profile = currentAgentId === 'analyst' ? ANALYST_PROFILE : CONSULTANT_PROFILE;
        rl.question(`\n  [${profile.icon} ${profile.name}] > `, async (input) => {
            const line = input.trim();

            if (!line) { prompt(); return; }

            // ── Commands ──────────────────────────────────────────────────────
            if (line === '/quit' || line === '/exit') {
                console.log('\n  Goodbye.\n');
                rl.close();
                return;
            }

            if (line === '/help') {
                printHelp();
                prompt();
                return;
            }

            if (line === '/clear') {
                engine.clearHistory();
                console.log('  History cleared.\n');
                prompt();
                return;
            }

            if (line === '/reindex') {
                process.stdout.write('  Re-indexing vault... ');
                const result = await rag.index({ verbose: false });
                console.log(`${result.indexed} new chunks, ${result.removed} removed.\n`);
                prompt();
                return;
            }

            if (line.startsWith('/agent ')) {
                const agentId = line.slice(7).trim();
                if (agentId === 'consultant' || agentId === 'analyst') {
                    engine.switchAgent(agentId);
                    currentAgentId = agentId;
                    const p = agentId === 'analyst' ? ANALYST_PROFILE : CONSULTANT_PROFILE;
                    console.log(`  Switched to ${p.icon} ${p.name}.\n`);
                } else {
                    console.log(`  Unknown agent "${agentId}". Available: consultant, analyst\n`);
                }
                prompt();
                return;
            }

            if (line.startsWith('/')) {
                console.log(`  Unknown command. Type /help for available commands.\n`);
                prompt();
                return;
            }

            // ── Agent run ─────────────────────────────────────────────────────
            console.log('');
            try {
                await engine.run(line);
            } catch (err) {
                console.error(`\n  Error: ${(err as Error).message}`);
            }
            console.log('');

            // Auto re-index so newly written notes are searchable next turn
            await rag.index({ verbose: false });

            prompt();
        });
    };

    prompt();
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
