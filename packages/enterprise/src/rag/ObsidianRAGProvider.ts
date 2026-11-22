import * as path from 'path';
import * as os from 'os';
import { defineTool, z } from '@backendkit-labs/agent-core';
import type { ToolDefinition } from '@backendkit-labs/agent-core';
import { OllamaEmbedder, OLLAMA_EMBED_DEFAULT_HOST, OLLAMA_EMBED_DEFAULT_MODEL } from './OllamaEmbedder';
import { VectorStore } from './VectorStore';
import { VaultIndexer } from './VaultIndexer';

/** Minimal interface any embedder must satisfy. */
export interface Embedder {
    readonly model: string;
    embed(texts: string[]): Promise<number[][]>;
    embedOne(text: string): Promise<number[]>;
}

export interface ObsidianRAGOptions {
    /** Ruta absoluta al vault de Obsidian. */
    vaultPath: string;
    /** Subcarpetas a indexar. Si está vacío, indexa todo el vault. */
    folders?: string[];
    /** Carpetas de primer nivel del vault que no se indexan nunca (por ejemplo las de RRHH y Finanzas en un indice global). */
    excludeFolders?: string[];
    /** Dónde guardar el índice vectorial. Default: ~/.bk-agent/rag/<vault-name>.json */
    indexPath?: string;
    /** Custom embedder. When provided, ollamaHost and embeddingModel are ignored. */
    embedder?: Embedder;
    /** Host de Ollama para embeddings. Default: http://localhost:11434 */
    ollamaHost?: string;
    /** Modelo de embeddings. Default: nomic-embed-text */
    embeddingModel?: string;
    /** Resultados máximos por búsqueda. Default: 5 */
    topK?: number;
    /** Score mínimo de similitud para incluir un resultado (0-1). Default: 0.3 */
    minScore?: number;
    /** Tags del frontmatter a excluir de la indexación. Default: ['skill'] */
    excludeTags?: string[];
    /**
     * Milisegundos de pausa entre batches durante index(). Un reindex grande (cientos
     * de archivos) corre CPU-bound sostenido a través de embed() sin dar respiro al
     * resto de la máquina; esta pausa le da al SO/otros procesos una ventana entre
     * batches. Default: 300ms. 0 desactiva el pacing.
     */
    batchPacingMs?: number;
    /**
     * Cantidad de archivos por etapa. Cada vez que el reindex completa una etapa,
     * pausa stagePacingMs en vez del batchPacingMs normal — un respiro más largo y
     * periódico además del pacing entre batches, para vaults muy grandes. Default: 50.
     */
    stageSize?: number;
    /** Milisegundos de pausa al completar cada etapa (stageSize archivos). Default: 3000ms. */
    stagePacingMs?: number;
    /**
     * Tiempo mínimo entre checkpoints del índice durante index(). Cada checkpoint serializa el índice
     * completo, así que guardar tras cada batch cuesta O(n²) en un vault grande. Un crash pierde como
     * mucho este intervalo de trabajo. Default: 30000ms. 0 guarda tras cada batch (comportamiento anterior).
     */
    checkpointIntervalMs?: number;
}

const BATCH_SIZE = 10;
const DEFAULT_BATCH_PACING_MS = 300;
const DEFAULT_STAGE_SIZE = 50;
const DEFAULT_STAGE_PACING_MS = 3000;
const DEFAULT_CHECKPOINT_INTERVAL_MS = 30_000;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export class ObsidianRAGProvider {
    private readonly embedder: Embedder;
    private readonly store: VectorStore;
    private readonly indexer: VaultIndexer;
    private readonly topK: number;
    private readonly minScore: number;
    private readonly batchPacingMs: number;
    private readonly stageSize: number;
    private readonly stagePacingMs: number;
    private readonly checkpointIntervalMs: number;
    private indexed = false;

    constructor(opts: ObsidianRAGOptions) {
        if (opts.embedder) {
            this.embedder = opts.embedder;
        } else {
            const host = opts.ollamaHost ?? OLLAMA_EMBED_DEFAULT_HOST;
            const model = opts.embeddingModel ?? OLLAMA_EMBED_DEFAULT_MODEL;
            this.embedder = new OllamaEmbedder({ host, model });
        }

        // Two providers over the same vault with other folders must not share an index: the later one would answer from the chunks of
        // the first (and remove the ones it does not scan). The scope is part of the name.
        const scope = [...(opts.folders ?? []).map(f => `in-${f}`), ...(opts.excludeFolders ?? []).map(f => `not-${f}`)].join('+');
        const defaultIndexPath = path.join(
            os.homedir(),
            '.bk-agent',
            'rag',
            `${path.basename(opts.vaultPath)}${scope ? `~${scope.replace(/[^a-zA-Z0-9_+~-]/g, '_')}` : ''}.json`
        );
        this.store = new VectorStore(opts.indexPath ?? defaultIndexPath, this.embedder.model);

        this.indexer = new VaultIndexer({
            vaultPath: opts.vaultPath,
            folders: opts.folders,
            excludeFolders: opts.excludeFolders,
            excludeTags: opts.excludeTags ?? ['skill'],
        });

        this.topK = opts.topK ?? 5;
        this.minScore = opts.minScore ?? 0.3;
        this.batchPacingMs = opts.batchPacingMs ?? DEFAULT_BATCH_PACING_MS;
        this.stageSize = opts.stageSize ?? DEFAULT_STAGE_SIZE;
        this.stagePacingMs = opts.stagePacingMs ?? DEFAULT_STAGE_PACING_MS;
        this.checkpointIntervalMs = opts.checkpointIntervalMs ?? DEFAULT_CHECKPOINT_INTERVAL_MS;
    }

    /**
     * Indexa el vault de forma incremental.
     * Solo re-embede archivos nuevos o modificados desde la última indexación.
     */
    async index(
        opts: { verbose?: boolean; onProgress?: (p: { processed: number; total: number }) => void } = {},
    ): Promise<{ indexed: number; removed: number }> {
        await this.store.load();
        const knownMtimes = this.store.getKnownMtimes();
        const { toIndex, toRemove } = await this.indexer.getChangedFiles(knownMtimes);

        for (const filePath of toRemove) {
            this.store.removeFile(filePath);
        }

        let indexed = 0;
        let lastCheckpoint = Date.now();
        for (let i = 0; i < toIndex.length; i += BATCH_SIZE) {
            const batch = toIndex.slice(i, i + BATCH_SIZE);
            const processedSoFar = Math.min(i + BATCH_SIZE, toIndex.length);
            const rawChunksBatch = await Promise.all(
                batch.map(f => this.indexer.buildChunks(f.filePath, f.mtime))
            );

            const allRaw = rawChunksBatch.flat();
            if (allRaw.length === 0) {
                opts.onProgress?.({ processed: processedSoFar, total: toIndex.length });
                continue;
            }

            const embeddings = await this.embedder.embed(allRaw.map(c => c.text));

            const vectorChunks = allRaw.map((raw, idx) =>
                this.indexer.toVectorChunk(raw, embeddings[idx] ?? [])
            );

            for (const f of batch) this.store.removeFile(f.filePath);
            this.store.addChunks(vectorChunks);
            indexed += vectorChunks.length;

            // Checkpoint, not just at the end — a crash mid-index (e.g. a large first-time vault
            // reindex) must resume from here instead of re-embedding everything from scratch. By time
            // rather than per batch: each save writes the whole index, so a save per batch is O(n²).
            if (Date.now() - lastCheckpoint >= this.checkpointIntervalMs) {
                await this.store.save();
                lastCheckpoint = Date.now();
            }
            opts.onProgress?.({ processed: processedSoFar, total: toIndex.length });

            if (opts.verbose) {
                console.log(`[RAG] Indexados ${processedSoFar}/${toIndex.length} archivos`);
            }

            // Pace between batches so a large reindex doesn't hold the CPU/memory
            // sustained for its whole duration. Skipped after the last batch. Every
            // stageSize files, take the longer stage pause instead of the regular one —
            // a periodic deeper breather on top of the per-batch pacing, for large vaults.
            const hasMoreBatches = i + BATCH_SIZE < toIndex.length;
            if (hasMoreBatches) {
                const processedSoFar = i + BATCH_SIZE;
                const crossedStageBoundary = Math.floor(processedSoFar / this.stageSize) >
                    Math.floor((processedSoFar - BATCH_SIZE) / this.stageSize);
                const pauseMs = crossedStageBoundary ? this.stagePacingMs : this.batchPacingMs;
                if (pauseMs > 0) await sleep(pauseMs);
            }
        }

        await this.store.save();
        this.indexed = true;

        return { indexed, removed: toRemove.length };
    }

    /** Busca en el vault usando similitud semántica. */
    async search(query: string, topK?: number): Promise<string> {
        if (!this.indexed) {
            await this.index();
        }

        const queryEmbedding = await this.embedder.embedOne(query);
        const results = this.store.search(queryEmbedding, topK ?? this.topK);
        const filtered = results.filter(r => r.score >= this.minScore);

        if (filtered.length === 0) {
            return 'No se encontró información relevante en la base de conocimiento para esa consulta.';
        }

        return filtered
            .map((r, i) => {
                const { chunk, score } = r;
                const area = chunk.metadata.area ? ` | área: ${chunk.metadata.area}` : '';
                const stack = chunk.metadata.stack ? ` | stack: ${chunk.metadata.stack}` : '';
                // A note an agent wrote is a claim of that agent, not a document of the company: the reader is told.
                const author = chunk.metadata.author ? ` | escrita por un agente (${chunk.metadata.author}), no verificada` : '';
                return [
                    `--- Resultado ${i + 1} (relevancia: ${(score * 100).toFixed(0)}%${area}${stack}${author}) ---`,
                    `Fuente: ${chunk.title}${chunk.section ? ` › ${chunk.section}` : ''}`,
                    chunk.text,
                ].join('\n');
            })
            .join('\n\n');
    }

    /** Devuelve el tool search_knowledge listo para registrar en ToolRegistry. */
    createTool(): ToolDefinition {
        const self = this;
        return defineTool({
            name: 'search_knowledge',
            description:
                "Search the company's knowledge base (Obsidian vault). " +
                'Use this when you need domain-specific information, processes, policies, or internal documentation.',
            input: z.object({
                query: z.string().describe('Question or topic to search in natural language'),
                top_k: z.number().int().min(1).max(20).optional()
                    .describe('Maximum number of results (default: 5)'),
            }),
            execute: async ({ query, top_k }) => {
                return self.search(query, top_k);
            },
        });
    }

    get chunkCount(): number {
        return this.store.size;
    }
}
