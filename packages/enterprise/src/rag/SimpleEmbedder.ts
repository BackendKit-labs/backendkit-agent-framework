/**
 * SimpleEmbedder — local TF-IDF with feature hashing, no external dependencies.
 *
 * Produces 256-dimensional unit vectors by:
 *   1. Tokenising text into lowercase alphanumeric tokens
 *   2. Mapping each token to a bucket via djb2 hash % DIMS
 *   3. Accumulating term-frequency counts in the bucket
 *   4. L2-normalising to a unit vector
 *
 * Not semantically equivalent to transformer embeddings, but clusters texts
 * with shared vocabulary close together — sufficient to find notes whose
 * content matches the query's key terms.
 *
 * Use this when Ollama is not available (dev, CI, pilot). For production,
 * prefer OllamaEmbedder with nomic-embed-text for semantic accuracy.
 */

import type { Embedder } from './ObsidianRAGProvider';

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

function vectorise(text: string): number[] {
    const vec = new Array<number>(DIMS).fill(0);
    const tokens = tokenise(text);
    if (tokens.length === 0) return vec;

    for (const t of tokens) {
        vec[djb2(t) % DIMS] += 1;
    }

    // L2 normalise
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm > 0) {
        for (let i = 0; i < DIMS; i++) vec[i] /= norm;
    }

    return vec;
}

export class SimpleEmbedder implements Embedder {
    readonly model = 'simple-tfidf-256';

    async embed(texts: string[]): Promise<number[][]> {
        return texts.map(vectorise);
    }

    async embedOne(text: string): Promise<number[]> {
        return vectorise(text);
    }
}
