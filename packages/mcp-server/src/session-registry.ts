export interface Closable { close(): Promise<void> }

export interface SessionRegistryOptions {
    /** A session untouched for this long is closed and forgotten. Default 30 min. */
    ttlMs?: number;
    /** New sessions are refused (see `isFull`) at this many live ones. Default 1000. */
    maxSessions?: number;
    /** How often idle sessions are looked for. Default 60 s. */
    sweepEveryMs?: number;
    now?: () => number;
}

/**
 * Live MCP HTTP sessions, each with its transport. They used to sit in a plain Map for as long as the
 * process ran: a client that vanished without closing (a crashed IDE, a dropped network) left its transport
 * and server behind forever, and nothing bounded how many could pile up.
 */
export class SessionRegistry<T extends Closable> {
    private readonly entries = new Map<string, { value: T; lastSeen: number }>();
    private readonly ttlMs: number;
    private readonly maxSessions: number;
    private readonly sweepEveryMs: number;
    private readonly now: () => number;
    private timer: ReturnType<typeof setInterval> | undefined;

    constructor(opts: SessionRegistryOptions = {}) {
        this.ttlMs = opts.ttlMs ?? 30 * 60_000;
        this.maxSessions = opts.maxSessions ?? 1_000;
        this.sweepEveryMs = opts.sweepEveryMs ?? 60_000;
        this.now = opts.now ?? Date.now;
    }

    get size(): number { return this.entries.size; }

    has(id: string): boolean { return this.entries.has(id); }

    isFull(): boolean { return this.entries.size >= this.maxSessions; }

    /** The session's value, counting this lookup as activity. */
    get(id: string): T | undefined {
        const entry = this.entries.get(id);
        if (!entry) return undefined;
        entry.lastSeen = this.now();
        return entry.value;
    }

    set(id: string, value: T): void {
        this.entries.set(id, { value, lastSeen: this.now() });
        if (!this.timer && this.sweepEveryMs > 0) {
            this.timer = setInterval(() => { void this.sweep(); }, this.sweepEveryMs);
            this.timer.unref?.();
        }
    }

    delete(id: string): void { this.entries.delete(id); }

    /** Closes and forgets every session idle for more than the ttl. Returns how many. */
    async sweep(): Promise<number> {
        const cutoff = this.now() - this.ttlMs;
        const stale = [...this.entries].filter(([, e]) => e.lastSeen < cutoff);
        for (const [id] of stale) this.entries.delete(id);
        await Promise.allSettled(stale.map(([, e]) => e.value.close()));
        return stale.length;
    }

    /** Closes every session and stops the sweep (server shutdown). */
    async closeAll(): Promise<void> {
        if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
        const all = [...this.entries.values()];
        this.entries.clear();
        await Promise.allSettled(all.map(e => e.value.close()));
    }
}
