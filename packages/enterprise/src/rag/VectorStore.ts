import * as fs from 'fs/promises';
import * as path from 'path';

export interface VectorChunk {
    id: string;
    filePath: string;
    title: string;
    section: string;
    text: string;
    embedding: number[];
    metadata: {
        tags: string[];
        description: string;
        mtime: number;
        area?: string;
        stack?: string;
    };
}

interface StoreFile {
    version: '1';
    embeddingModel: string;
    chunks: VectorChunk[];
}

function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot   += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

export interface SearchResult {
    chunk: VectorChunk;
    score: number;
}

export class VectorStore {
    private chunks: VectorChunk[] = [];
    private readonly storePath: string;
    private readonly embeddingModel: string;
    private dirty = false;

    constructor(storePath: string, embeddingModel: string) {
        this.storePath = storePath;
        this.embeddingModel = embeddingModel;
    }

    async load(): Promise<void> {
        try {
            const raw = await fs.readFile(this.storePath, 'utf-8');
            const data = JSON.parse(raw) as StoreFile;
            // Si el modelo de embeddings cambió, el índice no es compatible
            if (data.embeddingModel !== this.embeddingModel) {
                this.chunks = [];
                return;
            }
            this.chunks = data.chunks;
        } catch {
            this.chunks = [];
        }
    }

    async save(): Promise<void> {
        if (!this.dirty) return;
        await fs.mkdir(path.dirname(this.storePath), { recursive: true });
        const data: StoreFile = {
            version: '1',
            embeddingModel: this.embeddingModel,
            chunks: this.chunks,
        };
        await fs.writeFile(this.storePath, JSON.stringify(data), 'utf-8');
        this.dirty = false;
    }

    /** Devuelve los mtime conocidos por filePath para detectar cambios. */
    getKnownMtimes(): Map<string, number> {
        const map = new Map<string, number>();
        for (const chunk of this.chunks) {
            if (!map.has(chunk.filePath)) {
                map.set(chunk.filePath, chunk.metadata.mtime);
            }
        }
        return map;
    }

    /** Elimina todos los chunks de un archivo (para re-indexar). */
    removeFile(filePath: string): void {
        const before = this.chunks.length;
        this.chunks = this.chunks.filter(c => c.filePath !== filePath);
        if (this.chunks.length !== before) this.dirty = true;
    }

    addChunks(newChunks: VectorChunk[]): void {
        if (newChunks.length === 0) return;
        this.chunks.push(...newChunks);
        this.dirty = true;
    }

    search(queryEmbedding: number[], topK: number): SearchResult[] {
        return this.chunks
            .map(chunk => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);
    }

    get size(): number {
        return this.chunks.length;
    }
}
