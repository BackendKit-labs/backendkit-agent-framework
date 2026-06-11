// ── Session metadata store ─────────────────────────────────────────────────────
//
// The live AgentEngine + WebSocketTransport can't be serialized, so the in-memory
// Map in SessionManager remains the authoritative runtime store.
//
// SessionMetaStore persists lightweight metadata (id, userId, timestamps) to a
// durable backend.  Use cases:
//   - List active sessions across multiple server instances
//   - Audit trail: who connected when, from which session id
//   - Future: resume conversation history after reconnect
//
// Implementations:
//   InMemorySessionMetaStore  — default, zero deps, single-instance
//   RedisSessionMetaStore     — pass any Redis-like client (ioredis, node-redis)

export interface SessionMeta {
    id: string;
    createdAt: string;       // ISO-8601
    lastActivityAt: string;  // ISO-8601
    userId?: string;
    /** Extra fields the application wants to track. */
    [key: string]: unknown;
}

export interface SessionMetaStore {
    set(id: string, meta: SessionMeta): Promise<void>;
    get(id: string): Promise<SessionMeta | null>;
    delete(id: string): Promise<void>;
    list(): Promise<SessionMeta[]>;
    close(): Promise<void>;
}

// ── In-memory (default) ───────────────────────────────────────────────────────

export class InMemorySessionMetaStore implements SessionMetaStore {
    private data = new Map<string, SessionMeta>();

    async set(id: string, meta: SessionMeta): Promise<void> {
        this.data.set(id, meta);
    }

    async get(id: string): Promise<SessionMeta | null> {
        return this.data.get(id) ?? null;
    }

    async delete(id: string): Promise<void> {
        this.data.delete(id);
    }

    async list(): Promise<SessionMeta[]> {
        return [...this.data.values()];
    }

    async close(): Promise<void> {
        this.data.clear();
    }
}

// ── Redis ─────────────────────────────────────────────────────────────────────
// Duck-typed: works with ioredis, node-redis v4, upstash, etc.
// The client only needs get / set / del / keys / quit.

export interface RedisLike {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, expiryMode: string, time: number): Promise<unknown>;
    del(key: string): Promise<unknown>;
    keys(pattern: string): Promise<string[]>;
    quit(): Promise<unknown>;
}

export class RedisSessionMetaStore implements SessionMetaStore {
    private readonly prefix: string;
    private readonly ttl: number;

    constructor(
        private readonly redis: RedisLike,
        opts: { prefix?: string; ttlSeconds?: number } = {},
    ) {
        this.prefix = opts.prefix ?? 'bk:session:';
        this.ttl = opts.ttlSeconds ?? 4 * 60 * 60; // 4 h default
    }

    private key(id: string): string {
        return `${this.prefix}${id}`;
    }

    async set(id: string, meta: SessionMeta): Promise<void> {
        await this.redis.set(this.key(id), JSON.stringify(meta), 'EX', this.ttl);
    }

    async get(id: string): Promise<SessionMeta | null> {
        const raw = await this.redis.get(this.key(id));
        return raw ? (JSON.parse(raw) as SessionMeta) : null;
    }

    async delete(id: string): Promise<void> {
        await this.redis.del(this.key(id));
    }

    async list(): Promise<SessionMeta[]> {
        const keys = await this.redis.keys(`${this.prefix}*`);
        const results = await Promise.all(keys.map(k => this.redis.get(k)));
        return results
            .filter((r): r is string => r !== null)
            .map(r => JSON.parse(r) as SessionMeta);
    }

    async close(): Promise<void> {
        await this.redis.quit();
    }
}
