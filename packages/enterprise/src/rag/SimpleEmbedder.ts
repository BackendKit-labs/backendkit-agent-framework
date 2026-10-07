/**
 * SimpleEmbedder — local TF-IDF with feature hashing, no external dependencies.
 *
 * Produces 256-dimensional unit vectors by:
 *   1. Tokenising text into lowercase alphanumeric tokens
 *   2. Mapping each token to a bucket via djb2 hash % DIMS
 *   3. Accumulating term-frequency counts in the bucket
 *   4. Weighting each bucket by inverse document frequency (rarer buckets score higher)
 *   5. L2-normalising to a unit vector
 *
 * Not semantically equivalent to transformer embeddings, but clusters texts
 * with shared vocabulary close together — sufficient to find notes whose
 * content matches the query's key terms, and the IDF term keeps common
 * words (the, and, sistema, ...) from drowning out the words that actually
 * distinguish one note from another.
 *
 * Use this when Ollama is not available (dev, CI, pilot). For production,
 * prefer OllamaEmbedder with nomic-embed-text for semantic accuracy.
 */

import type { Embedder } from './ObsidianRAGProvider';
import * as fs from 'fs/promises';

const DIMS = 256;

function djb2(str: string): number {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul((h << 5) + h, 1) + str.charCodeAt(i);
    }
    return Math.abs(h);
}

function tokenise(text: string): string[] {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')   // strip diacritics
        .split(/[^a-z0-9]+/)
        .filter(t => t.length > 2);         // skip 1-2 char noise tokens
}

interface StatsFile {
    version: 1;
    docCount: number;
    docFreq: Record<string, number>;   // bucket index (as string key) -> document count
}

export class SimpleEmbedder implements Embedder {
    readonly model = 'simple-tfidf-256';

    private docCount = 0;
    private readonly docFreq = new Map<number, number>();
    private loaded = false;

    /**
     * @param statsPath Optional path to persist document-frequency stats across
     * process restarts. Without it, IDF starts fresh (pure TF) every time the
     * process starts and improves as more text gets embedded during that run.
     */
    constructor(private readonly statsPath?: string) {}

    private async ensureLoaded(): Promise<void> {
        if (this.loaded) return;
        this.loaded = true;
        if (!this.statsPath) return;
        try {
            const raw = await fs.readFile(this.statsPath, 'utf-8');
            const data = JSON.parse(raw) as StatsFile;
            this.docCount = data.docCount;
            for (const [bucket, count] of Object.entries(data.docFreq)) {
                this.docFreq.set(Number(bucket), count);
            }
        } catch {
            // No stats file yet — start fresh.
        }
    }

    private async persist(): Promise<void> {
        if (!this.statsPath) return;
        const data: StatsFile = {
            version: 1,
            docCount: this.docCount,
            docFreq: Object.fromEntries(this.docFreq),
        };
        await fs.writeFile(this.statsPath, JSON.stringify(data), 'utf-8');
    }

    /** Smoothed IDF — always positive, well-defined even when a bucket has never been seen (df=0). */
    private idf(bucket: number): number {
        const df = this.docFreq.get(bucket) ?? 0;
        return Math.log((this.docCount + 1) / (df + 1)) + 1;
    }

    private vectorise(text: string): number[] {
        const vec = new Array<number>(DIMS).fill(0);
        const tokens = tokenise(text);
        if (tokens.length === 0) return vec;

        for (const t of tokens) {
            vec[djb2(t) % DIMS] += 1;
        }

        // Weight each occupied bucket by IDF, then L2-normalise.
        let norm = 0;
        for (let i = 0; i < DIMS; i++) {
            if (vec[i] > 0) vec[i] *= this.idf(i);
            norm += vec[i] * vec[i];
        }
        norm = Math.sqrt(norm);
        if (norm > 0) {
            for (let i = 0; i < DIMS; i++) vec[i] /= norm;
        }

        return vec;
    }

    /** Registers `text` as a corpus document (updates docFreq/docCount), then vectorises it against the updated stats. */
    private observe(text: string): number[] {
        const buckets = new Set(tokenise(text).map(t => djb2(t) % DIMS));
        for (const b of buckets) this.docFreq.set(b, (this.docFreq.get(b) ?? 0) + 1);
        this.docCount++;
        return this.vectorise(text);
    }

    /** Indexing path — each text counts toward the corpus's document-frequency stats. */
    async embed(texts: string[]): Promise<number[][]> {
        await this.ensureLoaded();
        const vectors = texts.map(t => this.observe(t));
        await this.persist();
        return vectors;
    }

    /** Query path — a search query is not a new corpus document, so it's weighted read-only against current stats, never counted. */
    async embedOne(text: string): Promise<number[]> {
        await this.ensureLoaded();
        return this.vectorise(text);
    }
}
