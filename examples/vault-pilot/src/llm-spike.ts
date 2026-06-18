/**
 * LLM Quality Spike (Fase 6)
 *
 * Runs the same onboarding step (welcome_draft) with two providers:
 *   1. DeepSeek (cloud)
 *   2. Ollama llama3.2:3b (local)
 *
 * Measures latency, token count (from usage events), and captures full output.
 * Writes a comparison note to the vault so the team can review quality offline.
 *
 * Prerequisites:
 *   - DEEPSEEK_API_KEY set
 *   - Ollama running: `ollama serve && ollama pull llama3.2:3b`
 *
 * Run:
 *   DEEPSEEK_API_KEY=<key> npm run spike
 */

import 'dotenv/config';
import * as net from 'net';
import * as path from 'path';
import * as os from 'os';
import {
    AgentEngine,
    AgentRegistry,
    ToolRegistry,
    ProviderRegistry,
    CallbackTransport,
    defineTool,
    z,
} from '@backendkit-labs/agent-core';
import type { AgentEvent } from '@backendkit-labs/agent-core';
import {
    ObsidianRAGProvider,
    VaultWriter,
    SimpleEmbedder,
    HR_PROFILE,
} from '@backendkit-labs/agent-enterprise';
import { DeepSeekProvider } from './providers/DeepSeekProvider';

// ── Config ─────────────────────────────────────────────────────────────────────

const VAULT_PATH = process.env.VAULT_PATH ?? path.resolve(__dirname, '../vault');
const INDEX_DIR  = path.join(os.homedir(), '.bk-agent', 'rag', 'spike');
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';

const SPIKE_PROMPT = `A new employee is joining the company.
Employee name: Laura Martínez
Work email:    laura.martinez@empresa.com
Department:    Sales
Start date:    2026-09-01

Draft a short (3–4 sentences) welcome message for Laura.
Include: greeting, what to expect on day 1, and one key contact in HR.`;

// ── Helpers ────────────────────────────────────────────────────────────────────

async function checkOllama(host: string, port: number): Promise<boolean> {
    return new Promise(resolve => {
        const socket = new net.Socket();
        socket.setTimeout(1500);
        socket.connect(port, host, () => { socket.destroy(); resolve(true); });
        socket.on('error', () => resolve(false));
        socket.on('timeout', () => { socket.destroy(); resolve(false); });
    });
}

interface RunResult {
    provider: string;
    model: string;
    output: string;
    durationMs: number;
    promptTokens: number;
    completionTokens: number;
    error?: string;
}

async function runWithProvider(
    providerName: string,
    model: string,
    rag: ObsidianRAGProvider,
    writer: VaultWriter,
    engineFactory: (transport: CallbackTransport) => AgentEngine,
): Promise<RunResult> {
    const tokens: string[] = [];
    let promptTokens = 0;
    let completionTokens = 0;
    let error: string | undefined;

    const transport = new CallbackTransport((evt: AgentEvent) => {
        if (evt.type === 'token') tokens.push(evt.content);
        if (evt.type === 'metrics') {
            promptTokens     += evt.input_tokens;
            completionTokens += evt.output_tokens;
        }
    });

    const engine = engineFactory(transport);
    const start = Date.now();

    try {
        await engine.run(SPIKE_PROMPT);
    } catch (err) {
        error = (err as Error).message;
    }

    return {
        provider: providerName,
        model,
        output: tokens.join(''),
        durationMs: Date.now() - start,
        promptTokens,
        completionTokens,
        error,
    };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
        console.error('✗  DEEPSEEK_API_KEY required.');
        process.exit(1);
    }

    console.log('\n  LLM Quality Spike — welcome_draft step');
    console.log('  ─────────────────────────────────────────────────\n');

    // ── Check Ollama availability ──────────────────────────────────────────────

    const [ollamaHost, ollamaPort] = OLLAMA_URL.replace('http://', '').split(':');
    const ollamaAvailable = await checkOllama(ollamaHost, parseInt(ollamaPort ?? '11434'));

    if (!ollamaAvailable) {
        console.warn(`  ⚠  Ollama not available at ${OLLAMA_URL}. Skipping local model.`);
        console.warn('  To run full spike: ollama serve && ollama pull ' + OLLAMA_MODEL + '\n');
    }

    // ── Shared RAG + vault writer ──────────────────────────────────────────────

    const embedder = new SimpleEmbedder();
    const rag = new ObsidianRAGProvider({
        vaultPath: VAULT_PATH,
        indexPath:  path.join(INDEX_DIR, 'spike.json'),
        embedder,
        topK: 3,
        minScore: 0.1,
    });

    process.stdout.write('  Indexing vault... ');
    await rag.index({ verbose: false });
    console.log('done.\n');

    const writer = new VaultWriter({ vaultPath: VAULT_PATH, agentFolder: 'lecciones' });

    // ── Engine factory ─────────────────────────────────────────────────────────

    function makeEngine(provider: string, llmProvider: InstanceType<typeof DeepSeekProvider>, transport: CallbackTransport): AgentEngine {
        const tools = new ToolRegistry();
        tools.register(rag.createTool());
        tools.register(writer.createTool('spike'));

        const agents  = new AgentRegistry();
        agents.register(HR_PROFILE);

        const providers = new ProviderRegistry();
        providers.register(provider, llmProvider);

        return new AgentEngine({
            model:           { provider, id: '' },
            agents,
            tools,
            providers,
            defaultProvider: provider,
            defaultAgentId:  'hr',
            transport,
            maxIterations:   8,
            iterationMode:   'auto',
        });
    }

    // ── Run DeepSeek ───────────────────────────────────────────────────────────

    console.log('  Running with DeepSeek (deepseek-chat)...');
    const deepseekProvider = new DeepSeekProvider({ apiKey, model: 'deepseek-chat' });
    const deepseekResult = await runWithProvider(
        'deepseek', 'deepseek-chat', rag, writer,
        (t) => makeEngine('deepseek', deepseekProvider, t),
    );
    console.log(`  ✓ DeepSeek done in ${deepseekResult.durationMs}ms\n`);

    // ── Run Ollama ─────────────────────────────────────────────────────────────

    let ollamaResult: RunResult | null = null;

    if (ollamaAvailable) {
        console.log(`  Running with Ollama (${OLLAMA_MODEL})...`);
        const ollamaProvider = new DeepSeekProvider({
            apiKey: 'ollama',
            model:  OLLAMA_MODEL,
            baseUrl: `${OLLAMA_URL}/v1`,
        });
        ollamaResult = await runWithProvider(
            'ollama', OLLAMA_MODEL, rag, writer,
            (t) => makeEngine('ollama', ollamaProvider, t),
        );
        console.log(`  ✓ Ollama done in ${ollamaResult.durationMs}ms\n`);
    }

    // ── Print results ──────────────────────────────────────────────────────────

    console.log('  ═'.repeat(33));
    console.log('  SPIKE RESULTS\n');

    const results = [deepseekResult, ...(ollamaResult ? [ollamaResult] : [])];

    for (const r of results) {
        console.log(`  ── ${r.provider} / ${r.model} ──`);
        if (r.error) {
            console.log(`  ERROR: ${r.error}`);
        } else {
            console.log(`  Duration:  ${r.durationMs}ms`);
            console.log(`  Output length: ${r.output.length} chars`);
            console.log(`\n  ${r.output.replace(/\n/g, '\n  ')}\n`);
        }
    }

    // ── Write comparison note to vault ─────────────────────────────────────────

    const now = new Date().toISOString().slice(0, 10);
    const lines = [
        `# LLM Spike — Welcome Draft Quality (${now})`,
        '',
        `**Prompt**: Same welcome_draft step from \`onboarding-empleado.yaml\``,
        `**Employee**: Laura Martínez | Sales | 2026-09-01`,
        '',
        '## Results',
        '',
        ...results.map(r => [
            `### ${r.provider} / ${r.model}`,
            `- Duration: ${r.durationMs}ms`,
            `- Status: ${r.error ? `ERROR — ${r.error}` : 'OK'}`,
            `- Output length: ${r.output.length} chars`,
            '',
            '**Output:**',
            '',
            r.output || '*(no output)*',
            '',
        ].join('\n')),
        '## Verdict',
        '',
        ollamaResult && !ollamaResult.error
            ? `DeepSeek took ${deepseekResult.durationMs}ms vs Ollama ${ollamaResult.durationMs}ms. ` +
              'Review outputs above and document your quality assessment here.'
            : 'Ollama was not available during this run. Re-run with Ollama to complete the comparison.',
    ];

    await writer.writeNote({
        title: `LLM Spike — Welcome Draft (${now})`,
        content: lines.join('\n'),
        agentId: 'spike',
        tags: ['spike', 'llm', 'quality'],
    });

    console.log(`  Comparison note written to vault: lecciones/...llm-spike-welcome-draft-${now}.md\n`);
}

main().catch(err => {
    console.error('\nFatal error:', err);
    process.exit(1);
});
