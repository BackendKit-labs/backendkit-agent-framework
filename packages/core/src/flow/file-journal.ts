import { randomBytes } from 'node:crypto';
import { RetryEngine } from '@backendkit-labs/retry';
import { link, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { foldEvents, matches } from './journal';
import type { JournalEvent, JournalRun, JournalRunStatus, NewJournalRun, RunJournal, RunPatch, StepPatch } from './journal';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SEQ_WIDTH = 8;
/** Attempts to take the next event number against other processes before giving up. */
const APPEND_ATTEMPTS = 100;

/** Another process published the number we were about to take. */
class AppendContended extends Error { constructor() { super('contended'); this.name = 'AppendContended'; } }

/**
 * A run journal in a directory, with the technique of `FileApprovalStore`: every file is written under a temporary name and
 * published with a hard link, which fails if the target exists. So each write is atomic and exclusive across processes sharing
 * the directory, and a crash never leaves a half-written file under a final name.
 *
 * - `<runId>.ev.<seq>.json`: the events of the run, append-only; the run is rebuilt by folding them in order.
 * - `<runId>.claim.<n>.json`: the claims. The current one is the highest `n`; taking over an expired one means publishing
 *   `n+1`, which only one contender can do. Nothing is ever deleted or overwritten, so no lock is needed.
 */
export class FileRunJournal implements RunJournal {
    private ready?: Promise<unknown>;
    /** The last append of each run in this process, for serialising them. */
    private readonly tails = new Map<string, Promise<void>>();
    /** Retries the race for the next number with a small jittered wait; only a lost race is retried, not a missing run or a disk error. */
    private readonly retrier = new RetryEngine({
        name: 'file-journal:append',
        defaultConfig: {
            maxAttempts: APPEND_ATTEMPTS,
            backoff: { type: 'exponential', baseDelay: 1, multiplier: 1.4, maxDelay: 25, jitter: 'full' },
            retryIf: (p: { cause?: unknown }) => p.cause instanceof AppendContended,
        },
    });

    constructor(private readonly dir: string) {}

    async begin(run: NewJournalRun): Promise<void> {
        this.checkId(run.runId);
        const existing = await this.names(run.runId, 'ev');
        if (existing.length > 0) throw new Error(`run "${run.runId}" already exists`);
        const ev: JournalEvent = { kind: 'begin', at: new Date().toISOString(), run };
        try {
            await this.publish(this.file(run.runId, 'ev', 0), JSON.stringify(ev));
        } catch (err) {
            if ((err as { alreadyExists?: boolean }).alreadyExists) throw new Error(`run "${run.runId}" already exists`);
            throw err;
        }
    }

    async step(runId: string, stepId: string, patch: StepPatch): Promise<void> {
        await this.append(runId, { kind: 'step', at: new Date().toISOString(), stepId, patch });
    }

    async update(runId: string, patch: RunPatch): Promise<void> {
        await this.append(runId, { kind: 'update', at: new Date().toISOString(), patch });
    }

    async claim(runId: string, owner: string, ttlMs: number): Promise<(() => Promise<void>) | null> {
        this.checkId(runId);
        for (let attempt = 0; attempt < 5; attempt++) {
            const seqs = await this.seqs(runId, 'claim');
            const n = seqs.length ? seqs[seqs.length - 1] : -1;
            if (n >= 0) {
                const cur = await this.readJson<{ owner: string | null; expiresAt: number }>(this.file(runId, 'claim', n));
                if (cur && cur.owner !== null && cur.expiresAt > Date.now() && cur.owner !== owner) return null;
            }
            const next = n + 1;
            try {
                await this.publish(this.file(runId, 'claim', next), JSON.stringify({ owner, expiresAt: Date.now() + ttlMs }));
            } catch (err) {
                if ((err as { alreadyExists?: boolean }).alreadyExists) continue; // someone took n+1 first: look again
                throw err;
            }
            return async () => {
                // Release = a newer claim with no owner. If someone already took over, publishing fails and we lost it anyway.
                await this.publish(this.file(runId, 'claim', next + 1), JSON.stringify({ owner: null, expiresAt: 0 })).catch(() => undefined);
            };
        }
        return null;
    }

    async get(runId: string): Promise<JournalRun | undefined> {
        this.checkId(runId);
        const events: JournalEvent[] = [];
        for (const seq of await this.seqs(runId, 'ev')) {
            const ev = await this.readJson<JournalEvent>(this.file(runId, 'ev', seq));
            if (ev) events.push(ev);
        }
        return foldEvents(events);
    }

    async list(filter?: { status?: JournalRunStatus[]; flow?: string; tenantId?: string }): Promise<JournalRun[]> {
        let names: string[];
        try { names = await readdir(this.dir); } catch { return []; }
        const ids = new Set<string>();
        for (const n of names) {
            const m = /^(.+)\.ev\.\d+\.json$/.exec(n);
            if (m) ids.add(m[1]);
        }
        const out: JournalRun[] = [];
        for (const id of ids) {
            const r = await this.get(id);
            if (r && matches(r, filter)) out.push(r);
        }
        return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    }

    // ── internals ────────────────────────────────────────────────────────────

    private checkId(id: string): void {
        if (!ID.test(id)) throw new Error(`invalid run id "${id}"`);
    }

    private file(runId: string, kind: 'ev' | 'claim', seq: number): string {
        return join(this.dir, `${runId}.${kind}.${String(seq).padStart(SEQ_WIDTH, '0')}.json`);
    }

    private async names(runId: string, kind: 'ev' | 'claim'): Promise<string[]> {
        let names: string[];
        try { names = await readdir(this.dir); } catch { return []; }
        const prefix = `${runId}.${kind}.`;
        return names.filter(n => n.startsWith(prefix) && n.endsWith('.json'));
    }

    private async seqs(runId: string, kind: 'ev' | 'claim'): Promise<number[]> {
        const prefix = `${runId}.${kind}.`;
        return (await this.names(runId, kind))
            .map(n => Number(n.slice(prefix.length, -'.json'.length)))
            .filter(n => Number.isInteger(n))
            .sort((a, b) => a - b);
    }

    /**
     * The appends of one run go one after another within this process: a flow with a wide fan-out (dozens of steps finishing at
     * once) would otherwise have them all racing for the same next number and run out of attempts. Between processes the race
     * stays, and is settled by retrying with a little jitter.
     */
    private append(runId: string, ev: JournalEvent): Promise<void> {
        this.checkId(runId);
        const previous = this.tails.get(runId) ?? Promise.resolve();
        const result = previous.then(() => this.appendNow(runId, ev));
        const tail = result.catch(() => undefined);
        this.tails.set(runId, tail);
        void tail.then(() => { if (this.tails.get(runId) === tail) this.tails.delete(runId); });
        return result;
    }

    /** One try: find the next number and publish under it. Losing the race to another process is `AppendContended`, which is retried. */
    private async appendOnce(runId: string, ev: JournalEvent): Promise<void> {
        const seqs = await this.seqs(runId, 'ev');
        if (seqs.length === 0) throw new Error(`run "${runId}" does not exist`);
        try {
            await this.publish(this.file(runId, 'ev', seqs[seqs.length - 1] + 1), JSON.stringify(ev));
        } catch (err) {
            if ((err as { alreadyExists?: boolean }).alreadyExists) throw new AppendContended(); // another process took that number
            throw err;
        }
    }

    private async appendNow(runId: string, ev: JournalEvent): Promise<void> {
        const result = await this.retrier.execute(() => this.appendOnce(runId, ev));
        if (result.ok) return;
        if (result.error.cause instanceof AppendContended) throw new Error(`could not append to run "${runId}": too much contention`);
        throw result.error.cause ?? new Error(result.error.message);
    }

    private async readJson<T>(path: string): Promise<T | undefined> {
        try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return undefined; }
    }

    /** Write to a unique temporary file, then hard-link it under the final name (fails if it exists). */
    private async publish(target: string, content: string): Promise<void> {
        this.ready ??= mkdir(this.dir, { recursive: true });
        await this.ready;
        const tmp = join(this.dir, `.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
        await writeFile(tmp, content, { flag: 'wx' });
        try {
            await link(tmp, target);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw Object.assign(new Error('exists'), { alreadyExists: true });
            throw err;
        } finally {
            await unlink(tmp).catch(() => undefined);
        }
    }
}
