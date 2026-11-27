/**
 * A lock on a file, for stores that read, change and write it back (or compact it). Two layers:
 *
 * - **In the process:** calls on the same path run one after another (an async read-modify-write interleaved with
 *   another loses one of them even in a single process).
 * - **Across processes:** a `<path>.lock` file created exclusively (`wx`). Whoever holds it writes; the others wait.
 *   A lock older than `staleMs` is taken to belong to a process that died and is removed.
 *
 * It is advisory: it protects writers that use it, not a process that writes the file some other way.
 */
import { closeSync, mkdirSync, openSync, statSync, unlinkSync, writeSync } from 'fs';
import { mkdir, open, stat, unlink } from 'fs/promises';
import { dirname } from 'path';

export interface FileLockOptions {
    /** How long to wait for the lock before giving up. Default 10 s. */
    timeoutMs?: number;
    /** A lock file older than this is considered left by a dead process. Default 30 s. */
    staleMs?: number;
}

const RETRY_MS = 15;
const queues = new Map<string, Promise<unknown>>();

const lockPathOf = (path: string): string => `${path}.lock`;
const timeout = (path: string, ms: number) => new Error(`could not lock "${path}" within ${ms}ms (another writer holds ${lockPathOf(path)})`);

/** Runs `fn` holding the lock of `path`: serialized in this process and exclusive across processes. */
export async function withFileLock<T>(path: string, fn: () => Promise<T>, options: FileLockOptions = {}): Promise<T> {
    const previous = queues.get(path) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(async () => {
        const release = await acquire(path, options);
        try { return await fn(); } finally { await release(); }
    });
    const tail = run.catch(() => undefined);
    queues.set(path, tail);
    void tail.then(() => { if (queues.get(path) === tail) queues.delete(path); });
    return run;
}

/** The synchronous form, for stores whose API is synchronous. Waits by sleeping the thread briefly between tries. */
export function withFileLockSync<T>(path: string, fn: () => T, options: FileLockOptions = {}): T {
    const release = acquireSync(path, options);
    try { return fn(); } finally { release(); }
}

async function acquire(path: string, { timeoutMs = 10_000, staleMs = 30_000 }: FileLockOptions): Promise<() => Promise<void>> {
    const lock = lockPathOf(path);
    await mkdir(dirname(lock), { recursive: true });
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        try {
            const fh = await open(lock, 'wx', 0o600);
            await fh.write(`${process.pid} ${new Date().toISOString()}\n`);
            await fh.close();
            return async () => { await unlink(lock).catch(() => undefined); };
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        }
        try {
            if (Date.now() - (await stat(lock)).mtimeMs > staleMs) { await unlink(lock).catch(() => undefined); continue; }
        } catch { continue; } // it went away between the two calls: try again at once
        if (Date.now() > deadline) throw timeout(path, timeoutMs);
        await new Promise(r => setTimeout(r, RETRY_MS));
    }
}

const sleeper = new Int32Array(new SharedArrayBuffer(4));

function acquireSync(path: string, { timeoutMs = 10_000, staleMs = 30_000 }: FileLockOptions): () => void {
    const lock = lockPathOf(path);
    mkdirSync(dirname(lock), { recursive: true });
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        try {
            const fd = openSync(lock, 'wx', 0o600);
            try { writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`); } finally { closeSync(fd); }
            return () => { try { unlinkSync(lock); } catch { /* already gone */ } };
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        }
        try {
            if (Date.now() - statSync(lock).mtimeMs > staleMs) { try { unlinkSync(lock); } catch { /* raced */ } continue; }
        } catch { continue; }
        if (Date.now() > deadline) throw timeout(path, timeoutMs);
        Atomics.wait(sleeper, 0, 0, RETRY_MS);
    }
}
