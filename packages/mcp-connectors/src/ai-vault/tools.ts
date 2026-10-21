/**
 * bk-mcp-ai-vault — MCP server for the AI Engineering knowledge vault
 *
 * Exposes the ai-vault as semantic search tools so any agent or Claude Code
 * session can query AI/ML knowledge while working on AI projects.
 *
 * Required env vars:
 *   AI_VAULT_PATH   — absolute path to the ai-vault
 *                     default: C:/Users/mairon.cuello/development/workspace-ia/ai-vault
 *
 * Optional:
 *   AI_INDEX_PATH   — where to store the vector index
 *                     default: ~/.bk-agent/rag/ai-vault.json
 *   AI_TOP_K        — default results per search (default: 5)
 *   AI_MIN_SCORE    — minimum similarity score 0-1 (default: 0.2)
 *
 * Usage in claude_desktop_config.json / mcp settings:
 *   {
 *     "mcpServers": {
 *       "ai-vault": {
 *         "command": "npx",
 *         "args": ["-y", "@backendkit-labs/mcp-connectors", "bk-mcp-ai-vault"],
 *         "env": {
 *           "AI_VAULT_PATH": "C:/Users/mairon.cuello/development/workspace-ia/ai-vault"
 *         }
 *       }
 *     }
 *   }
 *
 * Or run directly:
 *   AI_VAULT_PATH=... npx bk-mcp-ai-vault
 */

import * as path from 'node:path';
import * as os   from 'node:os';
import { McpServer }             from '@modelcontextprotocol/sdk/server/mcp.js';
import { z }                     from 'zod';
import { ObsidianRAGProvider, SimpleEmbedder } from '@backendkit-labs/agent-enterprise';

// ── Config ────────────────────────────────────────────────────────────────────

const VAULT_PATH = process.env.AI_VAULT_PATH
    ?? 'C:/Users/mairon.cuello/development/workspace-ia/ai-vault';

const INDEX_PATH = process.env.AI_INDEX_PATH
    ?? path.join(os.homedir(), '.bk-agent', 'rag', 'ai-vault.json');

const TOP_K     = parseInt(process.env.AI_TOP_K     ?? '5');
const MIN_SCORE = parseFloat(process.env.AI_MIN_SCORE ?? '0.2');

// ── RAG provider (shared across all requests) ─────────────────────────────────

const rag = new ObsidianRAGProvider({
    vaultPath:  VAULT_PATH,
    indexPath:  INDEX_PATH,
    embedder:   new SimpleEmbedder(),
    topK:       TOP_K,
    minScore:   MIN_SCORE,
});

let indexReady = false;

async function ensureIndexed(): Promise<void> {
    if (!indexReady) {
        process.stderr.write('[ai-vault] Indexing vault...\n');
        const { indexed } = await rag.index({ verbose: false });
        process.stderr.write(`[ai-vault] Index ready — ${indexed} chunks\n`);
        indexReady = true;
    }
}

// ── Server factory ────────────────────────────────────────────────────────────

export function buildServer(): McpServer {
    const srv = new McpServer({ name: 'ai-vault', version: '0.1.0' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = srv.tool.bind(srv) as any;

    // ── Tool: search_ai_kb ────────────────────────────────────────────────────

    t(
        'search_ai_kb',
        'Search the AI Engineering knowledge base. ' +
        'Use this when you need to recall concepts, architectures, best practices or ' +
        'implementation patterns for: machine learning, deep learning, transformers, ' +
        'RAG, LLMs, prompt engineering, fine-tuning, agents, vision, generative AI, MLOps. ' +
        'Call it before designing or implementing any AI component to get relevant context.',
        {
            query: z.string().describe(
                'Natural language query: "how does self-attention work", ' +
                '"RAG pipeline with ChromaDB", "LoRA fine-tuning steps", ' +
                '"multi-agent orchestration patterns"',
            ),
            top_k: z.number().int().min(1).max(15).optional().describe(
                'Max results to return (default: 5)',
            ),
        },
        async ({ query, top_k }: { query: string; top_k?: number }) => {
            await ensureIndexed();
            const results = await rag.search(query, top_k);
            return { content: [{ type: 'text' as const, text: results }] };
        },
    );

    // ── Tool: list_ai_topics ──────────────────────────────────────────────────

    t(
        'list_ai_topics',
        'List the main topics and modules available in the AI knowledge base. ' +
        'Use this to discover what knowledge is indexed before searching.',
        {},
        async () => {
            const topics = [
                '## AI Engineering Knowledge Base',
                '',
                '### Módulo 0 — Fundamentos',
                '  Python para IA, NumPy/Pandas, álgebra lineal, Git',
                '',
                '### Módulo 1 — Machine Learning',
                '  Regresión lineal/polinomial, KNN, SVM & kernels, ensemble learning',
                '  (Random Forest, Gradient Boosting), feature engineering',
                '',
                '### Módulo 2 — Deep Learning',
                '  Perceptrón y MLP, backpropagation, PyTorch, CNNs,',
                '  optimizadores (Adam/SGD), regularización, transfer learning',
                '',
                '### Módulo 3 — Computer Vision',
                '  Arquitecturas CNN (LeNet, AlexNet, VGG, ResNet),',
                '  detección de objetos (YOLO, SSD), segmentación semántica (U-Net),',
                '  Vision Transformers (ViT)',
                '',
                '### Módulo 4 — NLP & Transformers',
                '  Tokenización, embeddings, Word2Vec, arquitectura Transformer,',
                '  BERT, GPT, RAG con ChromaDB y LangChain',
                '',
                '### Módulo 5 — Generative AI',
                '  VAEs, GANs, modelos de difusión (DDPM/DDIM/LDM),',
                '  Stable Diffusion, ControlNet, LoRA, generación de video/audio',
                '',
                '### Módulo 6 — LLMs & Prompt Engineering',
                '  Tokenización, pre-training, RLHF, SFT, prompt engineering avanzado,',
                '  fine-tuning con LoRA/QLoRA, RAG profundo, evaluación (BLEU, ROUGE, benchmarks)',
                '',
                '### Módulo 7 — Agentes de IA',
                '  Ciclo percibir→razonar→actuar, ReAct, function calling, MCP,',
                '  LangGraph, memoria de agentes, multi-agentes, seguridad y alineación',
                '',
                '### Módulo 8 — Producción (MLOps)',
                '  Ciclo de vida MLOps, MLflow, DVC, despliegue con vLLM/Docker/FastAPI,',
                '  monitoreo y observabilidad, proyecto final RAG+agentes en producción',
                '',
                `Vault: ${VAULT_PATH}`,
            ].join('\n');

            return { content: [{ type: 'text' as const, text: topics }] };
        },
    );

    return srv;
}
