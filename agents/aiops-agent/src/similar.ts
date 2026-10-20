import { performance } from 'node:perf_hooks';
import type { Db, IncidentRow } from './db';
import { getIncidents } from './db';
import type { Action, SimilarMatch, SimilarResult } from './types';

/** Minimal embedder contract (OllamaEmbedder satisfies it; tests inject a stub). */
export interface Embedder {
    embed(texts: string[]): Promise<number[][]>;
}

const toBlob = (v: number[]): Buffer => Buffer.from(new Float32Array(v).buffer);
const fromBlob = (b: Buffer): Float32Array =>
    new Float32Array(b.buffer, b.byteOffset, b.byteLength / Float32Array.BYTES_PER_ELEMENT);

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
    let dot = 0, na = 0, nb = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
        const x = a[i] as number, y = b[i] as number;
        dot += x * y; na += x * x; nb += y * y;
    }
    return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const tokenize = (s: string): Set<string> =>
    new Set(s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .split(/[^a-z0-9]+/).filter(t => t.length > 2));

export function keywordScore(query: string, doc: string): number {
    const q = tokenize(query), d = tokenize(doc);
    if (q.size === 0 || d.size === 0) return 0;
    let inter = 0;
    for (const t of q) if (d.has(t)) inter++;
    return inter / Math.sqrt(q.size * d.size);
}

const toMatch = (r: IncidentRow, score: number): SimilarMatch => ({
    id: r.id, title: r.title, score: Math.round(score * 1000) / 1000,
    resolution_action: r.resolution_action as Action, outcome: r.outcome,
});

/** Similar-incident search: embeddings in SQLite BLOBs + in-memory cosine (ADR-006). */
export class SimilarIncidents {
    constructor(private readonly db: Db, private readonly embedder: Embedder | null) {}

    /** Embed + persist vectors for incidents that lack one. Throws if the embedder fails. */
    async ensureEmbeddings(): Promise<void> {
        if (!this.embedder) return;
        const missing = getIncidents(this.db).filter(i => !i.embedding);
        if (missing.length === 0) { this.vectors(); return; }
        const vectors = await this.embedder.embed(missing.map(i => `${i.title}. ${i.text}`));
        this.cache = null;
        const upd = this.db.prepare('UPDATE incidents SET embedding = ? WHERE id = ?');
        this.db.transaction(() => {
            missing.forEach((inc, idx) => {
                const v = vectors[idx];
                if (v && v.length > 0) upd.run(toBlob(v), inc.id);
            });
        })();
        this.vectors(); // warm the cache: indexing cost stays out of the query path
    }

    private cache: Array<{ r: IncidentRow; v: Float32Array }> | null = null;

    /** Decoded vectors, loaded once per process (invalidated when embeddings change). */
    private vectors(): Array<{ r: IncidentRow; v: Float32Array }> {
        if (!this.cache) {
            this.cache = getIncidents(this.db).filter(r => r.embedding)
                .map(r => ({ r, v: fromBlob(r.embedding as Buffer) }));
        }
        return this.cache;
    }

    async search(query: string, k = 3): Promise<SimilarResult> {
        if (this.embedder) {
            try {
                await this.ensureEmbeddings();
                const t0 = performance.now();
                const [qv] = await this.embedder.embed([query]);
                const embedMs = performance.now() - t0;
                if (qv && qv.length > 0) {
                    const t1 = performance.now();
                    const scored = this.vectors()
                        .map(({ r, v }) => ({ r, s: cosine(qv, v) }))
                        .sort((x, y) => y.s - x.s)
                        .slice(0, k);
                    const searchMs = performance.now() - t1;
                    return {
                        method: 'embedding',
                        matches: scored.map(x => toMatch(x.r, x.s)),
                        embed_ms: round(embedMs), search_ms: round(searchMs),
                    };
                }
            } catch {
                // Embedder unavailable → keyword fallback (flagged via method).
            }
        }
        const t1 = performance.now();
        const scored = getIncidents(this.db)
            .map(r => ({ r, s: keywordScore(query, `${r.title} ${r.text} ${r.category}`) }))
            .filter(x => x.s > 0)
            .sort((x, y) => y.s - x.s)
            .slice(0, k);
        return {
            method: 'keyword', matches: scored.map(x => toMatch(x.r, x.s)),
            embed_ms: 0, search_ms: round(performance.now() - t1),
        };
    }
}

const round = (n: number): number => Math.round(n * 100) / 100;
