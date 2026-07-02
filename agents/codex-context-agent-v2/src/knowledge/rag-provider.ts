import { ObsidianRAGProvider } from '@backendkit-labs/agent-enterprise';
import { TransformersEmbedder, type EmbedderProgress } from './transformers-embedder.js';
import * as path from 'node:path';
import { bkPaths } from '@backendkit-labs/infra';

export interface RagSearchResult {
    title: string;
    content: string;
    relevance: number;
    sourcePath: string;
    sourceRef?: string;
}

export interface RagSearchOptions {
    topK?: number;
    minScore?: number;
}

export class CuratorRagProvider {
    private rag: ObsidianRAGProvider;
    private embedder: TransformersEmbedder;
    private vaultPath: string;
    private isIndexed: boolean = false;
    // Dedupe concurrent index passes so a reload and a cold-start search never run
    // two index() calls against the shared store at once.
    private indexing: Promise<{ indexed: number; updated: number }> | null = null;

    constructor(vaultPath: string) {
        this.vaultPath = vaultPath;
        this.embedder = new TransformersEmbedder(
            process.env.CODEX_EMBED_MODEL ?? 'Xenova/nomic-embed-text-v1'
        );
        const envPacing = parseInt(process.env.CODEX_INDEX_PACING_MS ?? '', 10);
        const envStageSize = parseInt(process.env.CODEX_INDEX_STAGE_SIZE ?? '', 10);
        const envStagePacing = parseInt(process.env.CODEX_INDEX_STAGE_PACING_MS ?? '', 10);
        this.rag = new ObsidianRAGProvider({
            vaultPath,
            indexPath: this.getIndexPath(),
            embedder: this.embedder,
            topK: 5,
            minScore: 0.1,
            batchPacingMs: Number.isFinite(envPacing) && envPacing >= 0 ? envPacing : undefined,
            stageSize: Number.isFinite(envStageSize) && envStageSize > 0 ? envStageSize : undefined,
            stagePacingMs: Number.isFinite(envStagePacing) && envStagePacing >= 0 ? envStagePacing : undefined,
        });
    }

    async initEmbedder(onProgress?: (info: EmbedderProgress) => void): Promise<{ alreadyCached: boolean }> {
        return this.embedder.init(onProgress);
    }

    private getIndexPath(): string {
        return bkPaths.ragIndex(path.basename(this.vaultPath));
    }

    async indexVault(): Promise<{ indexed: number; updated: number }> {
        // ObsidianRAGProvider.index() is incremental (loads the persisted index from
        // disk and re-embeds only changed files). Coalesce concurrent callers onto a
        // single in-flight pass.
        if (this.indexing) return this.indexing;
        this.indexing = (async () => {
            try {
                const result = await this.rag.index({ verbose: false });
                this.isIndexed = true;
                return { indexed: result.indexed, updated: result.removed };
            } catch (err) {
                throw new Error(`RAG indexing failed: ${(err as Error).message}`);
            } finally {
                this.indexing = null;
            }
        })();
        return this.indexing;
    }

    async search(query: string, opts: RagSearchOptions = {}): Promise<RagSearchResult[]> {
        if (!this.isIndexed) {
            await this.indexVault();
        }

        try {
            // ObsidianRAGProvider.search() returns a formatted string, not an array.
            // Access the underlying store and embedder directly for structured results.
            const rag = this.rag as any;
            const queryEmbedding = await rag.embedder.embedOne(query);
            const topK = opts.topK ?? 5;
            const minScore = opts.minScore ?? 0.1;
            const rawResults: { chunk: any; score: number }[] = rag.store.search(queryEmbedding, topK);

            return rawResults
                .filter(r => r.score >= minScore)
                .map(({ chunk, score }) => ({
                    title: chunk.title || 'Untitled',
                    content: chunk.text || '',
                    relevance: score,
                    sourcePath: chunk.filePath || '',
                    sourceRef: chunk.metadata?.sourceRef || undefined,
                }));
        } catch (err) {
            throw new Error(`RAG search failed: ${(err as Error).message}`);
        }
    }

    async reload(): Promise<{ indexed: number; updated: number }> {
        // Do NOT drop isIndexed here: index() is incremental and reloads from disk on
        // its own, so keeping the flag true lets concurrent searches keep serving the
        // current in-memory index instead of blocking on (or spawning) a reindex.
        return await this.indexVault();
    }

    async getStats(): Promise<{ indexed: boolean; vaultPath: string; indexPath: string }> {
        return {
            indexed: this.isIndexed,
            vaultPath: this.vaultPath,
            indexPath: this.getIndexPath(),
        };
    }
}
