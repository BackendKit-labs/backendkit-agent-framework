/**
 * Vault Pilot — Two enterprise agents sharing an Obsidian vault
 *
 * Phase 1 — Analyst agent:
 *   Receives a technical question, reads the vault for context, analyses,
 *   and writes its findings back to the vault.
 *
 * Phase 2 — Consultant agent:
 *   After the vault is re-indexed, receives an implementation question,
 *   finds the analyst's note, and answers based on it.
 *
 * Run:   DEEPSEEK_API_KEY=<key> npm start
 * Modes: uses DeepSeek for LLM + SimpleEmbedder (local, no Ollama required)
 */

import * as path from 'path';
import * as os from 'os';
import {
    AgentEngine,
    AgentRegistry,
    ToolRegistry,
    ProviderRegistry,
    CallbackTransport,
    createMemorySystem,
} from '@backendkit-labs/agent-core';
import type { AgentProfile, AgentEvent } from '@backendkit-labs/agent-core';
import { ObsidianRAGProvider, VaultWriter } from '@backendkit-labs/agent-enterprise';
import { DeepSeekProvider } from './providers/DeepSeekProvider';
import { SimpleEmbedder } from './embedders/SimpleEmbedder';

// ── Config ────────────────────────────────────────────────────────────────────

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? '';
const LLM_MODEL        = process.env.LLM_MODEL ?? 'deepseek-chat';
const VAULT_PATH       = process.env.VAULT_PATH
    ?? path.resolve(__dirname, '../../vault-pilot');
const INDEX_PATH     = path.join(os.homedir(), '.bk-agent', 'rag', 'vault-pilot.json');
const MEM_DIR        = path.join(os.homedir(), '.bk-agent', 'pilot-memory');

// ── Agent profiles ────────────────────────────────────────────────────────────

const ANALYST_PROFILE: AgentProfile = {
    id: 'analyst',
    name: 'Technical Analyst',
    icon: '🔬',
    description: 'Analyses technical problems and documents decisions in the shared vault.',
    systemPrompt: `You are a senior technical analyst for the BackendKit Agent Framework team.

Your job:
1. Search the knowledge vault for existing context on the topic using search_knowledge.
2. Reason about the problem with the information found.
3. Write your analysis and decision as a new note using write_knowledge so other agents
   and teammates can benefit from your findings.
4. Respond concisely summarising what you found and what you wrote.

Always search before writing — avoid duplicating knowledge that already exists.
Use ## headings in your notes to structure the content by section.`,
    allowedTools: ['search_knowledge', 'write_knowledge', 'memory_save_knowledge'],
};

const CONSULTANT_PROFILE: AgentProfile = {
    id: 'consultant',
    name: 'Implementation Consultant',
    icon: '💡',
    description: 'Answers implementation questions using the shared knowledge vault.',
    systemPrompt: `You are an implementation consultant for the BackendKit Agent Framework team.

Your job:
1. Search the knowledge vault for decisions, patterns, and guidelines relevant to the question.
2. Answer based on what the team has already decided — don't invent new approaches.
3. If you find a gap in the vault (relevant knowledge is missing), note it in your answer.

Always ground your answers in vault sources. Cite the note title when you reference it.`,
    allowedTools: ['search_knowledge', 'memory_recall'],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function printSeparator(label: string): void {
    const line = '─'.repeat(60);
    console.log(`\n${line}\n  ${label}\n${line}`);
}

async function runAgent(
    engine: AgentEngine,
    agentId: string,
    question: string,
): Promise<void> {
    printSeparator(`Agent: ${agentId}`);
    console.log(`Question: ${question}\n`);

    engine.switchAgent(agentId);
    await engine.run(question);
    console.log('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    if (!DEEPSEEK_API_KEY) {
        console.error('✗  DEEPSEEK_API_KEY env var is required. Set it and re-run.');
        process.exit(1);
    }

    console.log('BackendKit Vault Pilot');
    console.log(`Vault:     ${VAULT_PATH}`);
    console.log(`LLM:       DeepSeek ${LLM_MODEL}`);
    console.log(`Embedder:  SimpleEmbedder (local, no Ollama required)\n`);

    // ── RAG + Writer (shared between both agents) ─────────────────────────────
    const embedder = new SimpleEmbedder();
    const rag = new ObsidianRAGProvider({
        vaultPath: VAULT_PATH,
        indexPath: INDEX_PATH,
        embedder,
        topK:      4,
        minScore:  0.1,   // lower threshold — SimpleEmbedder scores are typically lower than neural embeddings
    });

    const writer = new VaultWriter({ vaultPath: VAULT_PATH });

    console.log('Indexing vault...');
    const { indexed, removed } = await rag.index({ verbose: true });
    console.log(`✓  Indexed ${indexed} chunks, removed ${removed}.\n`);

    // ── Memory (shared between both agents in this pilot) ─────────────────────
    const memory = createMemorySystem({
        episodic:   { provider: 'json', path: path.join(MEM_DIR, 'episodes.json') },
        semantic:   { provider: 'json', path: path.join(MEM_DIR, 'knowledge.json') },
        procedural: { provider: 'json', path: path.join(MEM_DIR, 'patterns.json') },
        retention:  { maxEpisodes: 200 },
    });

    // ── Tools ─────────────────────────────────────────────────────────────────
    const tools = new ToolRegistry();
    tools.register(rag.createTool());
    tools.register(writer.createTool('analyst'));
    for (const t of memory.getTools()) tools.register(t);

    // ── Agents ────────────────────────────────────────────────────────────────
    const agents = new AgentRegistry();
    agents.register(ANALYST_PROFILE);
    agents.register(CONSULTANT_PROFILE);

    // ── Provider ──────────────────────────────────────────────────────────────
    const providers = new ProviderRegistry();
    providers.register('deepseek', new DeepSeekProvider({ apiKey: DEEPSEEK_API_KEY, model: LLM_MODEL }));

    // ── Engine ────────────────────────────────────────────────────────────────
    const transport = new CallbackTransport((evt: AgentEvent) => {
        if (evt.type === 'token') {
            process.stdout.write(evt.content);
        } else if (evt.type === 'tool_call') {
            console.log(`\n[tool] ${evt.name}(${evt.args_preview ?? ''})`);
        } else if (evt.type === 'tool_result') {
            const preview = (evt.preview ?? '').slice(0, 120).replace(/\n/g, ' ');
            console.log(`[result:${evt.success ? 'ok' : 'err'}] ${preview}`);
        }
    });
    const engine = new AgentEngine({
        model:           { provider: 'deepseek', id: LLM_MODEL },
        agents,
        tools,
        providers,
        defaultProvider: 'deepseek',
        defaultAgentId:  'analyst',
        transport,
        maxIterations:   15,
        iterationMode:   'auto',
        memorySystem:    memory,
    });

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 1 — Analyst: analyse a problem and write findings to the vault
    // ═══════════════════════════════════════════════════════════════════════

    printSeparator('PHASE 1 — Analyst writes to vault');

    await runAgent(
        engine,
        'analyst',
        'Necesitamos implementar un sistema de cache para los embeddings del RAG. ' +
        'El objetivo es evitar re-calcular embeddings para queries que ya se hicieron ' +
        'antes en la misma sesión. Analiza las opciones y documenta la decisión.',
    );

    // Re-index so the consultant can find what the analyst just wrote
    console.log('Re-indexing vault to pick up analyst note...');
    const { indexed: newChunks } = await rag.index({ verbose: false });
    console.log(`✓  ${newChunks} new chunks indexed.\n`);

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 2 — Consultant: answer an implementation question using the vault
    // ═══════════════════════════════════════════════════════════════════════

    printSeparator('PHASE 2 — Consultant reads from vault');

    await runAgent(
        engine,
        'consultant',
        '¿Cómo debo implementar el cache de embeddings para el RAG? ' +
        '¿Hay alguna decisión ya tomada al respecto?',
    );

    // ═══════════════════════════════════════════════════════════════════════
    // Summary
    // ═══════════════════════════════════════════════════════════════════════

    printSeparator('Pilot complete');
    console.log(`Vault notes written by agents: ${VAULT_PATH}\\agentes\\`);
    console.log('You can open vault-pilot/ as an Obsidian vault to inspect the notes.\n');
}

main().catch((err) => {
    console.error('Pilot error:', err);
    process.exit(1);
});
