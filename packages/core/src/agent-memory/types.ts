// ── Records ───────────────────────────────────────────────────────────────────

export interface Episode {
    id: string;
    content: string;
    tags: string[];
    createdAt: Date;
    score?: number;
}

export interface Knowledge {
    id: string;
    content: string;
    metadata: Record<string, string>;
    embedding?: number[];
    createdAt: Date;
    score?: number;
}

export interface Pattern {
    id: string;
    trigger: string;
    action: string;
    outcome: 'success' | 'failure';
    occurrences: number;
    lastSeen: Date;
}

// ── Storage backend ───────────────────────────────────────────────────────────

/** Serializable record stored by any backend. */
export interface StoredRecord {
    id: string;
    createdAt: string; // ISO
    [key: string]: unknown;
}

export interface MemoryStoreBackend {
    insert(record: StoredRecord): void;
    upsert(id: string, record: StoredRecord): void;
    /** Replaces (or appends) several records in one write; each record's own `id` is the key. */
    upsertMany?(records: StoredRecord[]): void;
    getAll(): StoredRecord[];
    deleteOldest(keepNewest: number): void;
    deleteByIds(ids: string[]): void;
    count(): number;
}

// ── Embedding / summarization ─────────────────────────────────────────────────

/** Produces a vector embedding for a text. Inject to enable semantic similarity search. */
export type EmbedFn = (text: string) => Promise<number[]>;

/**
 * Condenses a list of episodes into a single summary string.
 * Inject to enable memory compaction (e.g., call an LLM).
 */
export type SummarizeFn = (episodes: Episode[]) => Promise<string>;

// ── Config ────────────────────────────────────────────────────────────────────

export interface EpisodicConfig {
    provider?: 'in-memory' | 'json';
    /** File path for 'json' provider. */
    path?: string;
}

export interface SemanticConfig {
    provider?: 'in-memory' | 'json';
    path?: string;
    /** When provided, enables vector similarity search instead of keyword search. */
    embedFn?: EmbedFn;
}

export interface ProceduralConfig {
    provider?: 'in-memory' | 'json';
    path?: string;
}

export interface RetentionConfig {
    /** Maximum number of episodes to keep. Oldest are pruned when exceeded. */
    maxEpisodes?: number;
    /** Maximum number of semantic-memory entries (oldest are pruned). Default 5000; `Infinity` removes the cap. */
    maxKnowledge?: number;
    /** Maximum number of learned patterns (least confirmed, then least recently seen, are pruned). Default 1000; `Infinity` removes the cap. */
    maxPatterns?: number;
    /**
     * After this many new episodes, trigger summarization (requires summarizeFn).
     * The resulting summary is stored as a new episode tagged 'summary'.
     */
    summarizeAfter?: number;
    summarizeFn?: SummarizeFn;
}

export interface MemorySystemConfig {
    episodic?: EpisodicConfig;
    semantic?: SemanticConfig;
    procedural?: ProceduralConfig;
    retention?: RetentionConfig;
}
