import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

/**
 * Assertions about the real system rather than what the agent says it did. They throw plain
 * `Error`s, so they work under any test runner (jest, vitest, node:test).
 */

function fingerprint(path: string): string {
    if (!existsSync(path)) return 'absent';
    const stat = statSync(path);
    if (stat.isDirectory()) return 'dir';
    return 'file:' + createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** The file exists and its content is exactly `expected` (a string, or a predicate over the content). */
export function fileEquals(path: string, expected: string | ((content: string) => boolean)): void {
    if (!existsSync(path)) throw new Error(`world.fileEquals: ${path} does not exist`);
    const content = readFileSync(path, 'utf8');
    const ok = typeof expected === 'function' ? expected(content) : content === expected;
    if (!ok) {
        const shown = content.length > 200 ? content.slice(0, 200) + '…' : content;
        throw new Error(`world.fileEquals: ${path} has unexpected content: ${JSON.stringify(shown)}`);
    }
}

/**
 * Snapshots `paths` now (content hash, or absence). Call `verify()` after the agent ran: it throws if
 * any of them was created, changed or removed.
 */
export function untouched(paths: string[]): { verify(): void } {
    const before = new Map(paths.map(p => [p, fingerprint(p)]));
    return {
        verify() {
            const changed = paths.filter(p => fingerprint(p) !== before.get(p));
            if (changed.length) throw new Error(`world.untouched: modified: ${changed.join(', ')}`);
        },
    };
}

function alive(pid: number): boolean {
    try { process.kill(pid, 0); return true; } catch (err) { return (err as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** The process is gone (waits up to `timeoutMs` for it to exit). */
export async function processGone(pid: number, opts: { timeoutMs?: number } = {}): Promise<void> {
    const end = Date.now() + (opts.timeoutMs ?? 5000);
    while (alive(pid)) {
        if (Date.now() > end) throw new Error(`world.processGone: process ${pid} is still running`);
        await new Promise(r => setTimeout(r, 25));
    }
}

export const world = { fileEquals, untouched, processGone };
