import { performance } from 'node:perf_hooks';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ObsidianRAGProvider, VectorStore, type Embedder } from '@backendkit-labs/agent-enterprise';

/**
 * Optional, READ-ONLY lookup of hand-written runbooks (ADR-010).
 * Advisory evidence only: results never reach the policy guard, and this module
 * never curates (no LLM, no writes outside its own vector index file).
 */

export interface KnowledgeNote {
    title: string;
    path: string;
    relevance: number;
    excerpt: string;
}

export interface KnowledgeResult {
    notes: KnowledgeNote[];
    latency_ms: number;
    /** Set when the lookup was skipped (no vault, no notes, embedder down). */
    skipped?: string;
}

export interface KnowledgeLookup {
    lookup(query: string, k?: number): Promise<KnowledgeResult>;
}

export interface VaultKnowledgeOptions {
    vaultPath: string;
    indexPath: string;
    embedder: Embedder;
    minScore?: number;
}

const EXCERPT_CHARS = 600;
/** Strip control chars and cap length: vault text is untrusted data. */
const excerptOf = (text: string): string =>
    text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\s+/g, ' ').trim().slice(0, EXCERPT_CHARS);

export class VaultKnowledge implements KnowledgeLookup {
    private readonly rag: ObsidianRAGProvider;
    private readonly store: VectorStore;
    private readonly minScore: number;
    private ready: Promise<void> | null = null;

    constructor(private readonly opts: VaultKnowledgeOptions) {
        this.minScore = opts.minScore ?? 0.3;
        this.rag = new ObsidianRAGProvider({
            vaultPath: opts.vaultPath, indexPath: opts.indexPath, embedder: opts.embedder,
            minScore: this.minScore, batchPacingMs: 0, stagePacingMs: 0,
        });
        this.store = new VectorStore(opts.indexPath, opts.embedder.model);
    }

    /** Incremental index (re-embeds only changed notes), then load the store. */
    private prepare(): Promise<void> {
        this.ready ??= (async () => {
            fs.mkdirSync(path.dirname(this.opts.indexPath), { recursive: true });
            await this.rag.index();
            await this.store.load();
        })();
        return this.ready;
    }

    async lookup(query: string, k = 3): Promise<KnowledgeResult> {
        const t0 = performance.now();
        const done = (notes: KnowledgeNote[], skipped?: string): KnowledgeResult => ({
            notes, latency_ms: Math.round((performance.now() - t0) * 100) / 100, ...(skipped ? { skipped } : {}),
        });
        if (!fs.existsSync(this.opts.vaultPath)) return done([], `vault no encontrado: ${this.opts.vaultPath}`);
        try {
            await this.prepare();
            const qv = await this.opts.embedder.embedOne(query);
            const hits = this.store.search(qv, k).filter(r => r.score >= this.minScore);
            // One note may produce several chunks: keep the best chunk per file.
            const seen = new Set<string>();
            const notes: KnowledgeNote[] = [];
            for (const { chunk, score } of hits) {
                if (seen.has(chunk.filePath)) continue;
                seen.add(chunk.filePath);
                notes.push({
                    title: chunk.title, path: path.relative(this.opts.vaultPath, chunk.filePath),
                    relevance: Math.round(score * 1000) / 1000, excerpt: excerptOf(chunk.text),
                });
            }
            return done(notes, notes.length === 0 ? 'sin notas relevantes' : undefined);
        } catch (e) {
            this.ready = null;
            return done([], `no disponible: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}
