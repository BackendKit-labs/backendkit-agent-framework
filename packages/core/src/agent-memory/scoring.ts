/** Tokenize text into lowercase terms of length >= 3. */
export function tokenize(text: string): string[] {
    return text.toLowerCase().split(/\W+/).filter(t => t.length >= 3);
}

/**
 * Keyword overlap score [0, 1] — what fraction of query terms appear in the doc.
 * Simple but effective for episodic recall without embeddings.
 */
export function keywordScore(query: string, doc: string): number {
    const queryTerms = new Set(tokenize(query));
    if (queryTerms.size === 0) return 0;
    const docText = doc.toLowerCase();
    const hits = [...queryTerms].filter(t => docText.includes(t)).length;
    return hits / queryTerms.size;
}

/** Cosine similarity between two equal-length vectors. Returns 0 for zero-magnitude inputs. */
export function cosine(a: number[], b: number[]): number {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot  += a[i] * (b[i] ?? 0);
        magA += a[i] * a[i];
        magB += (b[i] ?? 0) * (b[i] ?? 0);
    }
    return magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
}
