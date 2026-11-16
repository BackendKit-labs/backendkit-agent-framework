import type { MemoryStoreBackend } from '../agent-memory/types';

/** Failures that make a pattern only count if they are a big enough share of the calls (SPEC-0019 D2). */
export interface RateOptions {
    /** Share of the calls of a subject that failed with this pattern. Default 0.05. */
    minFailureRate: number;
    /** Below this many calls in the window the share means nothing, and only the count decides. Default 20. */
    minCalls: number;
}

export const DEFAULT_RATE: RateOptions = { minFailureRate: 0.05, minCalls: 20 };

interface Bucket {
    id: string;
    /** UTC day, `YYYY-MM-DD`. */
    day: string;
    tenantId?: string;
    agentId: string;
    domain: string;
    subject: string;
    /** Only when the success was counted with a context. A bucket from before contexts has none, and keeps reading as it did. */
    context?: string;
    n: number;
}

const FLUSH_MS = 5000;

/**
 * The successes, counted instead of stored (SPEC-0019 D1). A healthy agent makes thousands of correct calls, and one
 * experience each would push the failures out of the bounded store. A bucket is one day of one agent and subject, kept
 * in memory and written to its store at most every few seconds.
 */
export class SuccessCounters {
    private readonly buckets = new Map<string, Bucket>();
    private loaded = false;
    private dirty = false;
    private timer?: ReturnType<typeof setTimeout>;

    constructor(private readonly store: MemoryStoreBackend) {}

    /** One more correct call. */
    add(at: string, agentId: string, tenantId: string | undefined, domain: string, subject: string, context?: string): void {
        this.load();
        const day = at.slice(0, 10);
        const id = [day, tenantId ?? '', agentId, domain, subject, ...(context ? [context] : [])].join('\u0000');
        const bucket = this.buckets.get(id);
        if (bucket) bucket.n++;
        else this.buckets.set(id, { id, day, ...(tenantId ? { tenantId } : {}), agentId, domain, subject, ...(context ? { context } : {}), n: 1 });
        this.dirty = true;
        if (!this.timer) {
            this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, FLUSH_MS);
            this.timer.unref?.();
        }
    }

    /** Correct calls of a subject (and context: those counted without one are another bucket) since `sinceDay`, of one agent or of all. */
    since(sinceDay: string, tenantId: string | undefined, domain: string, subject: string, agentId?: string, context?: string): number {
        this.load();
        let total = 0;
        for (const b of this.buckets.values()) {
            if (b.day >= sinceDay && b.tenantId === tenantId && b.domain === domain && b.subject === subject && b.context === context && (!agentId || b.agentId === agentId)) {
                total += b.n;
            }
        }
        return total;
    }

    /** Writes what changed and drops the days before `keepFromDay`. */
    async flush(keepFromDay?: string): Promise<void> {
        if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
        this.load();
        const stale = keepFromDay ? [...this.buckets.values()].filter(b => b.day < keepFromDay) : [];
        for (const b of stale) this.buckets.delete(b.id);
        if (stale.length) { this.store.deleteByIds(stale.map(b => b.id)); this.dirty = true; }
        if (!this.dirty) return;
        this.dirty = false;
        const records = [...this.buckets.values()].map(b => ({ ...b, createdAt: `${b.day}T00:00:00.000Z`, kind: 'ok-bucket' }));
        if (this.store.upsertMany) this.store.upsertMany(records);
        else for (const r of records) this.store.upsert(r.id, r);
    }

    private load(): void {
        if (this.loaded) return;
        this.loaded = true;
        for (const r of this.store.getAll()) {
            if (r.kind !== 'ok-bucket') continue;
            const { createdAt: _createdAt, kind: _kind, ...bucket } = r as unknown as Bucket & { createdAt: string; kind: string };
            this.buckets.set(bucket.id, bucket);
        }
    }
}

/**
 * The patterns that already passed the rate (SPEC-0019, found by the trading bench). The rate decides when a pattern
 * ENTERS: once it is in, it stays while its failures stay in the window, however many correct calls pile up. Otherwise a
 * lesson that works would remove itself: the bot obeys it, its correct calls dilute the failure share, the lesson leaves
 * and the mistake comes back. A record is the key and the last day the pattern was seen; it expires after the window.
 */
export class QualifiedPatterns {
    private readonly days = new Map<string, string>();
    private loaded = false;

    constructor(private readonly store: MemoryStoreBackend) {}

    /** Did the pattern pass the rate, and was it seen since `sinceDay`? */
    has(key: string, sinceDay: string): boolean {
        this.load();
        const day = this.days.get(key);
        return day !== undefined && day >= sinceDay;
    }

    /** The pattern is in (it passed the rate, or it stayed): remember the day. */
    confirm(key: string, day: string): void {
        this.load();
        if (this.days.get(key) === day) return;
        this.days.set(key, day);
        this.store.upsert(`q|${key}`, { id: `q|${key}`, createdAt: `${day}T00:00:00.000Z`, kind: 'qualified', key, day });
    }

    /** The pattern has fewer failures than it needs: it leaves, and has to pass the rate again to come back. */
    drop(key: string): void {
        this.load();
        if (!this.days.delete(key)) return;
        this.store.deleteByIds([`q|${key}`]);
    }

    /** Forgets what was not seen since `keepFromDay`. */
    prune(keepFromDay: string): void {
        this.load();
        for (const [key, day] of [...this.days]) if (day < keepFromDay) this.drop(key);
    }

    private load(): void {
        if (this.loaded) return;
        this.loaded = true;
        for (const r of this.store.getAll()) {
            if (r.kind === 'qualified' && typeof r.key === 'string' && typeof r.day === 'string') this.days.set(r.key, r.day);
        }
    }
}
