import { randomUUID } from 'crypto';
import type { Knowledge, MemoryStoreBackend, RetentionConfig, SemanticConfig, StoredRecord } from './types';
import { InMemoryStore } from './stores/InMemoryStore';
import { JsonFileStore } from './stores/JsonFileStore';
import { keywordScore, cosine } from './scoring';

/** Entries kept when `retention.maxKnowledge` is not set. Each can carry an embedding of hundreds of floats. */
export const DEFAULT_MAX_KNOWLEDGE = 5_000;

interface KnowledgeRecord extends StoredRecord {
    content: string;
    metadata: Record<string, string>;
    embedding?: number[];
}

/**
 * Semantic memory — a searchable knowledge base.
 *
 * Without an embedFn: keyword overlap scoring.
 * With an embedFn: cosine similarity on stored embeddings (auto-computed on index).
 */
export class SemanticMemory {
    private readonly backend: MemoryStoreBackend;
    private readonly embedFn: SemanticConfig['embedFn'];
    private readonly maxKnowledge: number;

    constructor(cfg: SemanticConfig = {}, retention: RetentionConfig = {}) {
        this.maxKnowledge = retention.maxKnowledge ?? DEFAULT_MAX_KNOWLEDGE;
        this.backend = cfg.provider === 'json' && cfg.path
            ? new JsonFileStore(cfg.path)
            : new InMemoryStore();
        this.embedFn = cfg.embedFn;
    }

    /** Store a piece of knowledge. Returns the new entry ID. */
    async index(content: string, metadata: Record<string, string> = {}): Promise<string> {
        const id = randomUUID();
        const embedding = this.embedFn ? await this.embedFn(content) : undefined;
        this.backend.insert({
            id,
            content,
            metadata,
            ...(embedding ? { embedding } : {}),
            createdAt: new Date().toISOString(),
        });
        if (this.maxKnowledge < Infinity) this.backend.deleteOldest(this.maxKnowledge);
        return id;
    }

    /**
     * Find knowledge entries relevant to a query.
     * Uses cosine similarity when embeddings are available; falls back to keyword scoring.
     */
    async search(query: string, limit = 5): Promise<Knowledge[]> {
        const records = this.backend.getAll() as KnowledgeRecord[];

        const withEmbeddings = records.filter(r => r.embedding);

        if (this.embedFn && withEmbeddings.length > 0) {
            const qVec = await this.embedFn(query);
            return withEmbeddings
                .map(r => ({ ...toKnowledge(r), score: cosine(qVec, r.embedding!) }))
                .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
                .slice(0, limit);
        }

        return records
            .map(r => ({ ...toKnowledge(r), score: keywordScore(query, r.content) }))
            .filter(k => (k.score ?? 0) > 0)
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
            .slice(0, limit);
    }

    count(): number { return this.backend.count(); }
}

function toKnowledge(r: KnowledgeRecord): Knowledge {
    return {
        id: r.id,
        content: r.content,
        metadata: r.metadata,
        embedding: r.embedding,
        createdAt: new Date(r.createdAt),
    };
}
