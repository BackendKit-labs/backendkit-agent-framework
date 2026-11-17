import { createHash, createHmac, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, truncateSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { foldEvents, JournalConflict, JournalCorrupt, matches } from './journal';
import type { JournalEvent, JournalRun, JournalRunStatus, NewJournalRun, RunJournal, RunPatch, StepPatch } from './journal';

/**
 * A run journal with one file per run, `<runId>.ndjson`, one line per event (SPEC-0024). The design of the journal of Steward, in the SDK:
 *
 * - **Append only and chained.** Each line is `{ n, event, mac }` and its `mac` covers the line before it (HMAC-SHA256 with `key`, or a plain
 *   SHA-256 without one: that detects damage, not someone who can rewrite the whole file). A line that is removed, changed or inserted breaks the
 *   chain and the run is `JournalCorrupt`: it is not believed, and the other runs are still served (`problems` says which).
 * - **Each event is one write** with `O_APPEND` followed by `fsync`: `step` returns when it is on disk. A process that dies in the middle of a write
 *   leaves a last line with no newline; it was never acknowledged, so it is ignored when reading and cut off before the next write.
 * - **One writer per run.** The writes of a run go one after another within the process, and before each one the size of the file is compared with
 *   what this writer wrote: if it differs, somebody else wrote and this writer stops (`JournalConflict`) instead of interleaving with them.
 * - **The claim is a lock file** (`<runId>.lock`, created exclusively) with the pid of the process and a token that is new in every process. A holder
 *   that is gone is relieved at once, with no TTL to wait for; one that is alive is respected, however long it takes. `ttlMs` is ignored and the
 *   claim needs no renewal. It needs the processes to share a host: for runs shared across machines use RedisRunJournal.
 *
 * It stores the outputs of the steps as they are: the files are as sensitive as the data, so they are created readable by the owner only.
 */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ZERO = '0'.repeat(64);
/** Who this process is, for the locks. A pid alone is not enough: in a container node is often the same pid every time, so a lock left by the process that ran before would look like ours. */
const PROCESS_TOKEN = randomUUID();

interface Tail { n: number; mac: string; size: number }
interface Line { n: number; event: JournalEvent; mac: string }

export interface NdjsonRunJournalOptions {
    /** Key of the chain. Without it the chain is a plain SHA-256 (damage is detected, tampering is not). */
    key?: Buffer;
    /** `always` (default): `fsync` after every event. `never`: for tests and for disks where it is too slow. */
    fsync?: 'always' | 'never';
}

export class NdjsonRunJournal implements RunJournal {
    private readonly tails = new Map<string, Tail>();
    private readonly chains = new Map<string, Promise<void>>();
    /** Runs that failed their check, by run id, with why: they are left out of `list`. The people who operate the node should know. */
    readonly problems = new Map<string, string>();
    private readonly seen = new Map<string, { size: number; run: JournalRun }>();
    private readonly key?: Buffer;
    private readonly sync: boolean;

    constructor(private readonly dir: string, opts: NdjsonRunJournalOptions = {}) {
        this.key = opts.key;
        this.sync = (opts.fsync ?? 'always') === 'always';
        mkdirSync(dir, { recursive: true });
    }

    // ── RunJournal ───────────────────────────────────────────────────────────

    async begin(run: NewJournalRun): Promise<void> {
        const path = this.file(run.runId);
        const event: JournalEvent = { kind: 'begin', at: new Date().toISOString(), run };
        const mac = this.mac(ZERO, 0, event);
        const line = `${JSON.stringify({ n: 0, event, mac } satisfies Line)}\n`;
        let fd: number;
        try { fd = openSync(path, 'wx', 0o600); } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
            // A file with nothing acknowledged in it (the process died between creating it and writing the first line) is not a run.
            if (!this.hasAcknowledged(run.runId)) { try { unlinkSync(path); } catch { /* taken first by another */ } return this.begin(run); }
            throw new Error(`run "${run.runId}" already exists`);
        }
        try { writeSync(fd, line); if (this.sync) fsyncSync(fd); } finally { closeSync(fd); }
        this.syncDirectory();
        this.tails.set(run.runId, { n: 0, mac, size: Buffer.byteLength(line, 'utf8') });
    }

    async step(runId: string, stepId: string, patch: StepPatch): Promise<void> {
        await this.append(runId, () => ({ kind: 'step', at: new Date().toISOString(), stepId, patch }));
    }

    async update(runId: string, patch: RunPatch): Promise<void> {
        await this.append(runId, () => ({ kind: 'update', at: new Date().toISOString(), patch }));
    }

    async claim(runId: string, owner: string, _ttlMs: number): Promise<(() => Promise<void>) | null> {
        this.file(runId); // validates the id
        const path = this.lockFile(runId);
        const release = async (): Promise<void> => {
            const held = this.readLock(path);
            if (held?.token === PROCESS_TOKEN && held.owner === owner) { try { unlinkSync(path); } catch { /* already gone */ } }
        };
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const fd = openSync(path, 'wx', 0o600);
                try { writeSync(fd, JSON.stringify({ owner, pid: process.pid, token: PROCESS_TOKEN, at: new Date().toISOString() })); } finally { closeSync(fd); }
                return release;
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
                const held = this.readLock(path);
                // Ours: the same owner asking again is a renewal (it holds, nothing to write); another owner in this process is refused.
                if (held?.token === PROCESS_TOKEN) return held.owner === owner ? release : null;
                if (!this.holderIsGone(held)) return null;
                try { unlinkSync(path); } catch { /* another process relieved it first: look again */ }
            }
        }
        return null;
    }

    async get(runId: string): Promise<JournalRun | undefined> {
        const r = this.read(runId);
        return r ? foldEvents(r.events) : undefined;
    }

    async list(filter?: { status?: JournalRunStatus[]; flow?: string; tenantId?: string }): Promise<JournalRun[]> {
        const out: JournalRun[] = [];
        for (const name of readdirSync(this.dir)) {
            if (!name.endsWith('.ndjson')) continue;
            const id = name.slice(0, -'.ndjson'.length);
            if (!SAFE_ID.test(id)) continue;
            let run: JournalRun | undefined;
            const size = statSync(join(this.dir, name)).size;
            const known = this.seen.get(id);
            if (known && known.size === size) run = known.run;
            else {
                try {
                    const r = this.read(id);
                    run = r ? foldEvents(r.events) : undefined;
                    this.problems.delete(id);
                    if (run) this.seen.set(id, { size, run });
                } catch (err) {
                    if (err instanceof JournalCorrupt) { this.problems.set(id, err.message); continue; }
                    throw err;
                }
            }
            if (run && matches(run, filter)) out.push(run);
        }
        return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    }

    // ── internals ────────────────────────────────────────────────────────────

    private file(runId: string): string {
        if (!SAFE_ID.test(runId)) throw new Error(`invalid run id "${runId}"`);
        return join(this.dir, `${runId}.ndjson`);
    }
    private lockFile(runId: string): string { return join(this.dir, `${runId}.lock`); }

    private mac(prev: string, n: number, event: JournalEvent): string {
        const text = `${prev}\n${JSON.stringify({ n, event })}`;
        return this.key ? createHmac('sha256', this.key).update(text).digest('hex') : createHash('sha256').update(text).digest('hex');
    }

    /** Reads the file, checks every line and returns the events and where the good part ends. A last line with no newline is dropped. */
    private read(runId: string): { events: JournalEvent[]; tail: Tail; torn: boolean } | undefined {
        const path = this.file(runId);
        if (!existsSync(path)) return undefined;
        const lines = readFileSync(path, 'utf8').split('\n');
        const finalLine = lines.length - 1; // what follows the last newline: empty when the file ended cleanly
        const events: JournalEvent[] = [];
        let prev = ZERO; let good = 0; let torn = false;
        for (let i = 0; i < lines.length; i++) {
            const row = lines[i];
            if (row === '') {
                if (i < finalLine) throw new JournalCorrupt(runId, `line ${i + 1} is empty: the journal was damaged or edited`);
                continue;
            }
            if (i === finalLine) { torn = true; break; } // never acknowledged: one write carries the line and its newline
            let parsed: Line;
            try { parsed = JSON.parse(row) as Line; } catch { throw new JournalCorrupt(runId, `line ${i + 1} is not readable: the journal was damaged or edited`); }
            if (parsed.n !== events.length || parsed.mac !== this.mac(prev, parsed.n, parsed.event)) {
                throw new JournalCorrupt(runId, `line ${i + 1} does not follow the one before it: the journal was altered (a line removed, changed or added)`);
            }
            events.push(parsed.event);
            prev = parsed.mac;
            good += Buffer.byteLength(row, 'utf8') + 1;
        }
        return { events, tail: { n: events.length - 1, mac: prev, size: good }, torn };
    }

    private hasAcknowledged(runId: string): boolean {
        try { return (this.read(runId)?.events.length ?? 0) > 0; } catch { return true; } // a corrupt file is somebody's evidence: leave it
    }

    /** The writes of one run go one after another in this process (`runFlow` writes from many steps at once), and a failed one does not stop the next. */
    private append(runId: string, make: () => JournalEvent): Promise<void> {
        this.file(runId);
        const previous = this.chains.get(runId) ?? Promise.resolve();
        const result = previous.then(() => this.appendNow(runId, make()));
        const tail = result.catch(() => undefined);
        this.chains.set(runId, tail);
        void tail.then(() => { if (this.chains.get(runId) === tail) this.chains.delete(runId); });
        return result;
    }

    private appendNow(runId: string, event: JournalEvent): void {
        const path = this.file(runId);
        let tail = this.tails.get(runId);
        if (!tail) {
            // First write from this process: read the file, check it and cut off a last line that was left half written (the writer is whoever holds the claim).
            const r = this.read(runId);
            if (!r) throw new Error(`run "${runId}" does not exist`);
            if (statSync(path).size !== r.tail.size) truncateSync(path, r.tail.size);
            tail = r.tail;
            this.tails.set(runId, tail);
        }
        if (!existsSync(path)) { this.tails.delete(runId); throw new Error(`run "${runId}" does not exist`); }
        if (statSync(path).size !== tail.size) {
            this.tails.delete(runId);
            throw new JournalConflict(runId, `the journal of "${runId}" changed under this writer: someone else wrote to it`);
        }
        const n = tail.n + 1;
        const mac = this.mac(tail.mac, n, event);
        const line = `${JSON.stringify({ n, event, mac } satisfies Line)}\n`;
        const fd = openSync(path, 'a');
        try { writeSync(fd, line); if (this.sync) fsyncSync(fd); } finally { closeSync(fd); }
        this.tails.set(runId, { n, mac, size: tail.size + Buffer.byteLength(line, 'utf8') });
    }

    /** So that a file just created is still there after a power cut. Not every system lets a directory be synced (Windows does not): then it is skipped. */
    private syncDirectory(): void {
        if (!this.sync) return;
        try { const fd = openSync(this.dir, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } } catch { /* not supported here */ }
    }

    private readLock(path: string): { owner?: string; pid?: unknown; token?: unknown } | undefined {
        try { return JSON.parse(readFileSync(path, 'utf8')) as { owner?: string; pid?: unknown; token?: unknown }; } catch { return undefined; }
    }

    /**
     * Is the holder of the lock gone? The same pid with another token is the process that ran before this one: gone. Any other pid is asked
     * whether it still exists. A lock nobody can read is not held by anybody.
     */
    private holderIsGone(held: { pid?: unknown; token?: unknown } | undefined): boolean {
        if (!held) return true;
        const pid = held.pid;
        if (typeof pid !== 'number' || !Number.isInteger(pid)) return true;
        if (held.token === PROCESS_TOKEN) return false;
        if (pid === process.pid) return true;
        try { process.kill(pid, 0); return false; } catch (err) { return (err as NodeJS.ErrnoException).code === 'ESRCH'; }
    }
}
