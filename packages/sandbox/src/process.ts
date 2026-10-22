import { spawn, type ChildProcess } from 'node:child_process';
import type { SandboxExecResult } from '@backendkit-labs/agent-core';

/** Stdout+stderr kept in `SandboxExecResult.output` (the callback still gets everything). */
export const DEFAULT_MAX_OUTPUT_CHARS = 40_000;

/**
 * Stops a process and everything it started. A plain `proc.kill()` leaves the children of a shell
 * running (and on Windows does not reach them at all).
 */
export function killProcessTree(proc: ChildProcess): void {
    if (process.platform === 'win32' && proc.pid) {
        // taskkill must see the tree while the shell is alive (once cmd.exe dies Windows forgets its
        // children), so the shell is not killed here: /F ends it together with the rest.
        const tk = spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
        tk.on('error', () => proc.kill());
        tk.on('close', (code) => { if (code !== 0) proc.kill(); });
        return;
    }
    if (proc.pid) {
        try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* not a process group leader */ }
    }
    proc.kill();
}

export interface RunProcessOptions {
    timeoutMs?: number;
    signal?: AbortSignal;
    onOutput?: (chunk: string) => void;
    maxOutputChars?: number;
    /** Stops the process (default: the whole process tree). */
    kill?: (proc: ChildProcess) => void;
}

/**
 * Drives an already spawned process to the end: collects stdout and stderr interleaved in arrival order,
 * enforces the timeout, honours the abort signal and kills the whole tree when either fires.
 * Resolves as soon as the process closes, or immediately after it was killed for timeout / abort.
 */
export function runProcess(proc: ChildProcess, o: RunProcessOptions = {}): Promise<SandboxExecResult> {
    const max = o.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
    const kill = o.kill ?? killProcessTree;
    return new Promise<SandboxExecResult>((resolve) => {
        const chunks: string[] = [];
        let total = 0;
        let settled = false;
        const finish = (r: Omit<SandboxExecResult, 'output'>) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            o.signal?.removeEventListener('abort', onAbort);
            resolve({ ...r, output: chunks.join('') });
        };

        const collect = (data: Buffer) => {
            const s = data.toString('utf-8');
            o.onOutput?.(s);
            const room = max - total;
            if (room <= 0) return;
            chunks.push(s.length > room ? s.slice(0, room) : s);
            total += Math.min(s.length, room);
        };
        proc.stdout?.on('data', collect);
        proc.stderr?.on('data', collect);

        const onAbort = () => {
            kill(proc);
            finish({ exitCode: null, timedOut: false, aborted: true });
        };
        const timer: ReturnType<typeof setTimeout> | undefined = o.timeoutMs
            ? setTimeout(() => { kill(proc); finish({ exitCode: null, timedOut: true, aborted: false }); }, o.timeoutMs)
            : undefined;

        if (o.signal?.aborted) onAbort();
        else o.signal?.addEventListener('abort', onAbort, { once: true });

        proc.on('error', (err) => finish({ exitCode: null, timedOut: false, aborted: false, error: err.message }));
        proc.on('close', (code) => finish({ exitCode: code, timedOut: false, aborted: false }));
    });
}
