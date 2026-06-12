/**
 * AI Design Agent — Interactive REPL
 *
 * Conversational agent backed by the AI Engineering vault (9 modules, ~52 notes).
 * Ask questions about ML, deep learning, transformers, RAG, LLMs, agents,
 * generative AI and MLOps. The agent searches the vault before every response.
 *
 * Profiles:
 *   architect  — design guidance, architecture trade-offs, best practices
 *   reviewer   — reviews your implementations and gives concrete feedback
 *
 * Run:
 *   DEEPSEEK_API_KEY=<key> npm run ai-agent
 *
 * Optional:
 *   LLM_MODEL=deepseek-reasoner  (use reasoning model for complex design questions)
 *   AI_VAULT_PATH=/custom/path
 */

import 'dotenv/config';
import * as readline from 'readline';
import * as path     from 'path';
import * as os       from 'os';
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

const API_KEY    = process.env.DEEPSEEK_API_KEY ?? '';
const LLM_MODEL  = process.env.LLM_MODEL ?? 'deepseek-reasoner';
const IS_REASONER = LLM_MODEL.includes('reasoner') || LLM_MODEL.startsWith('o');
const VAULT_PATH = process.env.AI_VAULT_PATH
    ?? 'C:/Users/mairon.cuello/development/workspace-ia/ai-vault';
const INDEX_PATH = path.join(os.homedir(), '.bk-agent', 'rag', 'ai-vault.json');

// ── Agent profiles ────────────────────────────────────────────────────────────

const ARCHITECT_PROFILE: AgentProfile = {
    id:          'architect',
    name:        'AI Architect',
    icon:        '◈',
    description: 'Answers AI design questions using the knowledge vault as context.',
    systemPrompt: `You are a senior AI systems architect with deep expertise in machine learning,
deep learning, LLMs, RAG systems, multi-agent architectures and MLOps.

Your knowledge base is the AI Engineering vault — always call search_knowledge before responding.
If you find relevant notes, cite the source: "According to the vault note '...'".
If you discover a design pattern or trade-off worth documenting, write it back
to the vault using write_knowledge so it's available in future sessions.

How to answer:
- Search first, always — even for simple questions
- Be concrete: give architecture diagrams in text, specific hyperparameters, tool recommendations
- Explain trade-offs: "Use X when ... but Y when ..."
- If the vault lacks context, say so before drawing on general knowledge
- For implementation questions: give a minimal working code skeleton
- Write back insights that expand the vault's knowledge`,
    allowedTools: ['search_knowledge', 'write_knowledge'],
};

const REVIEWER_PROFILE: AgentProfile = {
    id:          'reviewer',
    name:        'AI Reviewer',
    icon:        '◉',
    description: 'Reviews AI implementations and gives concrete, actionable feedback.',
    systemPrompt: `You are a meticulous AI code and architecture reviewer.

When given an implementation or design to review:
1. Search the vault with search_knowledge for relevant best practices and patterns
2. Identify specific issues: correctness, performance, scalability, maintainability
3. Suggest concrete improvements with code snippets when applicable
4. Write a review summary to the vault using write_knowledge

Review framework:
- Correctness: does it do what it claims?
- Efficiency: any unnecessary computation, memory waste, or bottlenecks?
- Architecture: is it following established patterns from the vault?
- Edge cases: what inputs could break it?
- Production readiness: logging, error handling, monitoring

Be direct and specific. "Line X does Y — replace with Z because ..." is better than vague advice.`,
    allowedTools: ['search_knowledge', 'write_knowledge'],
};

// ── REPL ──────────────────────────────────────────────────────────────────────

const COMMANDS: Record<string, string> = {
    '/help':              'Show available commands',
    '/clear':             'Clear conversation history',
    '/reindex':           'Re-index the vault (picks up new notes)',
    '/agent architect':   'Switch to AI Architect (design + best practices)',
    '/agent reviewer':    'Switch to AI Reviewer (code + architecture review)',
    '/quit':              'Exit',
};

function printHelp(): void {
    console.log('\n  Commands:');
    for (const [cmd, desc] of Object.entries(COMMANDS)) {
        console.log(`    ${cmd.padEnd(24)} ${desc}`);
    }
    console.log('');
}

function printBanner(): void {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════════╗');
    console.log('  ║         AI Design Agent  — BackendKit Labs        ║');
    console.log('  ╚══════════════════════════════════════════════════╝');
    console.log(`  Vault:    ${VAULT_PATH}`);
    console.log(`  LLM:      DeepSeek ${LLM_MODEL}${IS_REASONER ? '  (reasoning mode)' : ''}`);
    console.log(`  Modules:  ML · Deep Learning · Transformers · RAG`);
    console.log(`            LLMs · Agents · GenAI · MLOps`);
    console.log('');
    console.log('  Ask anything about AI design, architecture or implementation.');
    console.log('  Type /help for commands.\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    if (!API_KEY) {
        console.error('✗  DEEPSEEK_API_KEY is required. Add it to pilot/.env or set in shell.');
        process.exit(1);
    }

    printBanner();

    // ── RAG ───────────────────────────────────────────────────────────────────
    const rag = new ObsidianRAGProvider({
        vaultPath: VAULT_PATH,
        indexPath:  INDEX_PATH,
        embedder:   new SimpleEmbedder(),
        topK:       6,
        minScore:   0.1,
    });

    const writer = new VaultWriter({ vaultPath: VAULT_PATH, agentFolder: 'insights' });

    process.stdout.write('  Indexing vault... ');
    const { indexed } = await rag.index({ verbose: false });
    console.log(`${indexed} chunks indexed.\n`);

    // ── Tools ─────────────────────────────────────────────────────────────────
    const tools = new ToolRegistry();
    tools.register(rag.createTool());
    tools.register(writer.createTool('architect'));

    // ── Agents ────────────────────────────────────────────────────────────────
    const agents = new AgentRegistry();
    agents.register(ARCHITECT_PROFILE);
    agents.register(REVIEWER_PROFILE);

    // ── Provider ──────────────────────────────────────────────────────────────
    const providers = new ProviderRegistry();
    providers.register('deepseek', new DeepSeekProvider({
        apiKey:      API_KEY,
        model:       LLM_MODEL,
        // Reasoning models (R1, o3…) require temperature=1 — setting 0 degrades quality
        temperature: IS_REASONER ? 1 : 0,
    }));

    // ── Transport ─────────────────────────────────────────────────────────────
    let currentAgentId = 'architect';

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
                const icon = evt.success ? '✓' : '✗';
                console.log(`  ${icon} ${preview}`);
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
        defaultAgentId:  'architect',
        transport,
        maxIterations:   20,
        iterationMode:   'auto',
    });

    // ── readline loop ─────────────────────────────────────────────────────────
    const rl = readline.createInterface({
        input:    process.stdin,
        output:   process.stdout,
        terminal: true,
    });

    const profiles: Record<string, AgentProfile> = {
        architect: ARCHITECT_PROFILE,
        reviewer:  REVIEWER_PROFILE,
    };

    const prompt = (): void => {
        const p = profiles[currentAgentId] ?? ARCHITECT_PROFILE;
        rl.question(`\n  [${p.icon} ${p.name}] > `, async (input) => {
            const line = input.trim();
            if (!line) { prompt(); return; }

            if (line === '/quit' || line === '/exit') {
                console.log('\n  Goodbye.\n');
                rl.close();
                return;
            }
            if (line === '/help') { printHelp(); prompt(); return; }
            if (line === '/clear') {
                engine.clearHistory();
                console.log('  History cleared.\n');
                prompt(); return;
            }
            if (line === '/reindex') {
                process.stdout.write('  Re-indexing... ');
                const r = await rag.index({ verbose: false });
                console.log(`${r.indexed} new chunks.\n`);
                prompt(); return;
            }
            if (line.startsWith('/agent ')) {
                const id = line.slice(7).trim();
                if (profiles[id]) {
                    engine.switchAgent(id);
                    currentAgentId = id;
                    const p2 = profiles[id]!;
                    console.log(`  Switched to ${p2.icon} ${p2.name}.\n`);
                } else {
                    console.log(`  Unknown agent "${id}". Available: architect, reviewer\n`);
                }
                prompt(); return;
            }
            if (line.startsWith('/')) {
                console.log('  Unknown command. Type /help.\n');
                prompt(); return;
            }

            // ── Run ───────────────────────────────────────────────────────────
            console.log('');
            try {
                await engine.run(line);
            } catch (err) {
                console.error(`\n  Error: ${(err as Error).message}`);
            }
            console.log('');

            // Auto re-index so insights written this turn are searchable next turn
            await rag.index({ verbose: false });

            prompt();
        });
    };

    prompt();
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
