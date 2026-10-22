export type JobStatus = 'running' | 'done' | 'failed' | 'cancelled';

export interface JobInfo {
    id: string;
    kind: string;
    owner: string;
    status: JobStatus;
    startedAt: number;
    endedAt?: number;
    summary?: string;
}

export interface JobSpec {
    kind: string;
    /** Agent that owns the job: nobody else can read or cancel it. */
    owner: string;
    /** Does the work. `append` adds to the job's output; `signal` aborts on cancel. The result becomes `summary`. */
    run(signal: AbortSignal, append: (chunk: string) => void): Promise<string | void>;
}

export interface JobOutput {
    text: string;
    /** Pass as `sinceOffset` to continue reading. */
    nextOffset: number;
    done: boolean;
}

export interface JobRegistry {
    start(spec: JobSpec): JobInfo;
    get(id: string, owner: string): JobInfo | undefined;
    output(id: string, owner: string, opts?: { sinceOffset?: number; waitMs?: number }): Promise<JobOutput>;
    cancel(id: string, owner: string): Promise<boolean>;
    list(owner: string): JobInfo[];
    /** Jobs that ended since the last call and were not reported yet. */
    drainFinished(owner: string): JobInfo[];
    /** Cancels every running job (engine abort / shutdown). */
    cancelAll(): Promise<void>;
}

export interface JobRegistryOptions {
    /** Live jobs per owner. Default 8. */
    maxPerOwner?: number;
    /** Output kept per job (ring buffer; offsets stay absolute). Default 64 KB. */
    retainOutputBytes?: number;
    /** How long a finished job stays readable. Default 10 minutes. */
    retainFinishedMs?: number;
    /** After a cancel, how long to wait for the job to wind down. Default 2000 ms. */
    cancelGraceMs?: number;
}

export class JobLimitError extends Error {
    readonly code = 'JOB_LIMIT_REACHED';
    constructor(owner: string, max: number) {
        super(`JOB_LIMIT_REACHED: "${owner}" already has ${max} running background jobs`);
    }
}

interface Entry {
    info: JobInfo;
    controller: AbortController;
    /** Retained output; `base` is the absolute offset of its first character. */
    buffer: string;
    base: number;
    settled: Promise<void>;
    notified: boolean;
    waiters: Array<() => void>;
}

export function createJobRegistry(options: JobRegistryOptions = {}): JobRegistry {
    const maxPerOwner = options.maxPerOwner ?? 8;
    const retainBytes = options.retainOutputBytes ?? 64 * 1024;
    const retainMs = options.retainFinishedMs ?? 10 * 60_000;
    const graceMs = options.cancelGraceMs ?? 2000;
    const entries = new Map<string, Entry>();
    const counters = new Map<string, number>();

    const purge = () => {
        const now = Date.now();
        for (const [id, e] of entries) {
            if (e.info.endedAt !== undefined && now - e.info.endedAt > retainMs) entries.delete(id);
        }
    };
    const mine = (id: string, owner: string): Entry | undefined => {
        purge();
        const e = entries.get(id);
        return e && e.info.owner === owner ? e : undefined;
    };
    const wake = (e: Entry) => { const w = e.waiters.splice(0); for (const fn of w) fn(); };
    const finish = (e: Entry, status: JobStatus, summary?: string) => {
        if (e.info.status !== 'running') return;
        e.info.status = status;
        e.info.endedAt = Date.now();
        if (summary) e.info.summary = summary;
        wake(e);
    };

    const registry: JobRegistry = {
        start(spec) {
            purge();
            const live = [...entries.values()].filter(e => e.info.owner === spec.owner && e.info.status === 'running').length;
            if (live >= maxPerOwner) throw new JobLimitError(spec.owner, maxPerOwner);
            const n = (counters.get(spec.kind) ?? 0) + 1;
            counters.set(spec.kind, n);
            const controller = new AbortController();
            const e: Entry = {
                info: { id: `${spec.kind}-${n}`, kind: spec.kind, owner: spec.owner, status: 'running', startedAt: Date.now() },
                controller, buffer: '', base: 0, settled: Promise.resolve(), notified: false, waiters: [],
            };
            const append = (chunk: string) => {
                if (e.info.status !== 'running' || !chunk) return;
                e.buffer += chunk;
                if (e.buffer.length > retainBytes) {
                    const cut = e.buffer.length - retainBytes;
                    e.buffer = e.buffer.slice(cut);
                    e.base += cut;
                }
                wake(e);
            };
            // run() starts right now (not a tick later), so a cancel straight after start still reaches it.
            e.settled = new Promise<string | void>(resolve => resolve(spec.run(controller.signal, append)))
                .then(
                    summary => finish(e, controller.signal.aborted ? 'cancelled' : 'done', typeof summary === 'string' ? summary : undefined),
                    err => finish(e, controller.signal.aborted ? 'cancelled' : 'failed', err instanceof Error ? err.message : String(err)),
                );
            entries.set(e.info.id, e);
            return { ...e.info };
        },

        get: (id, owner) => { const e = mine(id, owner); return e ? { ...e.info } : undefined; },

        async output(id, owner, opts = {}) {
            const e = mine(id, owner);
            if (!e) throw new Error(`job ${id} not found`);
            const since = Math.max(opts.sinceOffset ?? 0, 0);
            const end = () => e.base + e.buffer.length;
            if (opts.waitMs && opts.waitMs > 0 && e.info.status === 'running' && since >= end()) {
                await new Promise<void>(resolve => {
                    const timer = setTimeout(resolve, opts.waitMs);
                    e.waiters.push(() => { clearTimeout(timer); resolve(); });
                });
            }
            const from = Math.max(since, e.base);
            return { text: e.buffer.slice(from - e.base), nextOffset: end(), done: e.info.status !== 'running' };
        },

        async cancel(id, owner) {
            const e = mine(id, owner);
            if (!e || e.info.status !== 'running') return false;
            e.controller.abort('cancelled');
            let timer: ReturnType<typeof setTimeout> | undefined;
            await Promise.race([e.settled, new Promise<void>(r => { timer = setTimeout(r, graceMs); })]);
            clearTimeout(timer);
            finish(e, 'cancelled');
            return true;
        },

        list(owner) {
            purge();
            return [...entries.values()].filter(e => e.info.owner === owner).map(e => ({ ...e.info }));
        },

        drainFinished(owner) {
            purge();
            const out: JobInfo[] = [];
            for (const e of entries.values()) {
                if (e.info.owner === owner && e.info.status !== 'running' && !e.notified) {
                    e.notified = true;
                    out.push({ ...e.info });
                }
            }
            return out;
        },

        async cancelAll() {
            const running = [...entries.values()].filter(e => e.info.status === 'running');
            await Promise.all(running.map(e => registry.cancel(e.info.id, e.info.owner)));
        },
    };
    return registry;
}
