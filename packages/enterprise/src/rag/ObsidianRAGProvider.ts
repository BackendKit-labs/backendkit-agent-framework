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
}

const BATCH_SIZE = 10;

export class ObsidianRAGProvider {
    private readonly embedder: Embedder;
    private readonly store: VectorStore;
    private readonly indexer: VaultIndexer;
    private readonly topK: number;
    private readonly minScore: number;
    private indexed = false;

    constructor(opts: ObsidianRAGOptions) {
        if (opts.embedder) {
            this.embedder = opts.embedder;
        } else {
            const host = opts.ollamaHost ?? OLLAMA_EMBED_DEFAULT_HOST;
            const model = opts.embeddingModel ?? OLLAMA_EMBED_DEFAULT_MODEL;
            this.embedder = new OllamaEmbedder({ host, model });
        }

        const defaultIndexPath = path.join(
            os.homedir(),
            '.bk-agent',
            'rag',
            `${path.basename(opts.vaultPath)}.json`
        );
        this.store = new VectorStore(opts.indexPath ?? defaultIndexPath, this.embedder.model);

        this.indexer = new VaultIndexer({
            vaultPath: opts.vaultPath,
            folders: opts.folders,
            excludeTags: opts.excludeTags ?? ['skill'],
        });

        this.topK = opts.topK ?? 5;
        this.minScore = opts.minScore ?? 0.3;
    }

    /**
     * Indexa el vault de forma incremental.
     * Solo re-embede archivos nuevos o modificados desde la última indexación.
     */
    async index(opts: { verbose?: boolean } = {}): Promise<{ indexed: number; removed: number }> {
        await this.store.load();
        const knownMtimes = this.store.getKnownMtimes();
        const { toIndex, toRemove } = await this.indexer.getChangedFiles(knownMtimes);

        for (const filePath of toRemove) {
            this.store.removeFile(filePath);
        }

        let indexed = 0;
        for (let i = 0; i < toIndex.length; i += BATCH_SIZE) {
            const batch = toIndex.slice(i, i + BATCH_SIZE);
            const rawChunksBatch = await Promise.all(
                batch.map(f => this.indexer.buildChunks(f.filePath, f.mtime))
            );

            const allRaw = rawChunksBatch.flat();
            if (allRaw.length === 0) continue;

            const embeddings = await this.embedder.embed(allRaw.map(c => c.text));

            const vectorChunks = allRaw.map((raw, idx) =>
                this.indexer.toVectorChunk(raw, embeddings[idx] ?? [])
            );

            for (const f of batch) this.store.removeFile(f.filePath);
            this.store.addChunks(vectorChunks);
            indexed += vectorChunks.length;

            if (opts.verbose) {
                console.log(`[RAG] Indexados ${Math.min(i + BATCH_SIZE, toIndex.length)}/${toIndex.length} archivos`);
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
                return [
                    `--- Resultado ${i + 1} (relevancia: ${(score * 100).toFixed(0)}%${area}${stack}) ---`,
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
