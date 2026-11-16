import type { MemoryStoreBackend } from '../agent-memory/types';
import type { LearnedPattern, PatternRecord } from './types';

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

/** A record with the view it belongs to (`<agentId>|<tenant>\0<pattern key>`; an empty agent is the view of all of them). */
export type PatternEntry = PatternRecord & { view: string };

/**
 * What the module remembers of each pattern (SPEC-0022). The rate decides when a pattern ENTERS (SPEC-0019); once in, the
 * record stays: the failures that made it leave the window, and what it has to say (the line of the lesson, its count and
 * its dates) must not leave with them, or a lesson that works would remove itself and the mistake would come back.
 * A record is written by the pattern that confirms it, and read by the lessons and the proposals.
 *
 * Records of a published 0.42 (`kind: 'qualified'`, the key and the last day) are still read: they count as "already in"
 * until the pattern confirms and a full record replaces them.
 */
export class PatternRecords {
    private readonly map = new Map<string, PatternRecord>();
    private readonly legacy = new Map<string, string>();
    private loaded = false;

    constructor(private readonly store: MemoryStoreBackend) {}

    /** What is known of the pattern of one view: never seen, in, or resolved by a person. */
    state(view: string, sinceDay: string): { state: 'none' | 'active' | 'resolved'; resolvedAt?: string } {
        this.load();
        const rec = this.map.get(view);
        if (rec) return rec.state === 'resolved' ? { state: 'resolved', resolvedAt: rec.resolvedAt } : { state: 'active' };
        const day = this.legacy.get(view);
        return day !== undefined && day >= sinceDay ? { state: 'active' } : { state: 'none' };
    }

    /** The pattern is in (it passed the rate, it stayed, or it came back after being resolved). */
    confirm(view: string, agentId: string, p: LearnedPattern): void {
        this.load();
        const prev = this.map.get(view);
        // What a lesson says about the pattern is the first thing it saw: the line is written once and later failures do not rewrite it.
        const rec: PatternRecord = prev ? { ...prev } : {
            key: p.key, agentId, ...(p.tenantId ? { tenantId: p.tenantId } : {}), domain: p.domain, kind: p.kind,
            ...(p.subject ? { subject: p.subject } : {}), ...(p.context ? { context: p.context } : {}),
            ...(p.fingerprint ? { fingerprint: p.fingerprint } : {}),
            situation: p.situation, ...(p.detail ? { detail: p.detail } : {}), severity: p.severity,
            count: p.count, firstSeen: p.firstSeen, lastFailure: p.lastSeen, state: 'active',
        };
        if (prev) {
            rec.count = p.count;
            rec.severity = p.severity;
            if (p.lastSeen > prev.lastFailure) rec.lastFailure = p.lastSeen;
            if (prev.state === 'resolved') {
                rec.state = 'active';
                rec.reappeared = { resolvedAt: prev.resolvedAt ?? '', by: prev.resolvedBy ?? { kind: 'human', id: 'unknown' } };
                delete rec.resolvedAt; delete rec.resolvedBy; delete rec.resolvedReason;
            }
        }
        this.save(view, rec);
    }

    /** A person says it is solved: it stops being a lesson, and the record stays to tell if it comes back. */
    resolve(view: string, by: PatternRecord['resolvedBy'], at: string, reason?: string): boolean {
        this.load();
        const rec = this.map.get(view);
        if (!rec || rec.state === 'resolved') return false;
        const next: PatternRecord = { ...rec, state: 'resolved', resolvedAt: at, ...(by ? { resolvedBy: by } : {}), ...(reason ? { resolvedReason: reason } : {}) };
        delete next.reappeared;
        this.save(view, next);
        return true;
    }

    /** Writes the line of a lesson, once. */
    setLine(view: string, line: string): void {
        this.load();
        const rec = this.map.get(view);
        if (rec && rec.line === undefined) this.save(view, { ...rec, line });
    }

    list(): PatternEntry[] {
        this.load();
        return [...this.map].map(([view, rec]) => ({ ...rec, view }));
    }

    /** Forgets the records `drop` says are not worth keeping. */
    prune(drop: (rec: PatternEntry) => boolean): void {
        this.load();
        for (const rec of this.list()) {
            if (!drop(rec)) continue;
            this.map.delete(rec.view);
            this.store.deleteByIds([`p|${rec.view}`]);
        }
        for (const [view, day] of [...this.legacy]) {
            if (day < this.legacyKeep) { this.legacy.delete(view); this.store.deleteByIds([`q|${view}`]); }
        }
    }

    /** Legacy records older than this day are dropped by `prune`. */
    legacyKeep = '';

    private save(view: string, rec: PatternRecord): void {
        const before = this.map.get(view);
        if (before && JSON.stringify(before) === JSON.stringify(rec)) return;
        this.map.set(view, rec);
        if (this.legacy.delete(view)) this.store.deleteByIds([`q|${view}`]);
        this.store.upsert(`p|${view}`, { id: `p|${view}`, createdAt: rec.firstSeen, kind: 'pattern', view, rec });
    }

    private load(): void {
        if (this.loaded) return;
        this.loaded = true;
        for (const r of this.store.getAll()) {
            if (r.kind === 'pattern' && typeof r.view === 'string' && r.rec && typeof r.rec === 'object') {
                this.map.set(r.view, r.rec as PatternRecord);
            } else if (r.kind === 'qualified' && typeof r.key === 'string' && typeof r.day === 'string') {
                this.legacy.set(r.key, r.day);
            }
        }
    }
}
