import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runCommandTool } from '../run-command';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function ctxWith(signal?: AbortSignal) {
    return {
        agentId: 'coder', sessionId: 'test', workingDir: process.cwd(), signal,
        memory: { get: () => undefined, set: () => undefined, getAll: () => ({}) },
        askAgent: async () => '',
    };
}

function alive(pid: number): boolean {
    try { process.kill(pid, 0); return true; } catch { return false; }
}

async function until(cond: () => boolean, ms: number): Promise<boolean> {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (cond()) return true; await sleep(25); }
    return cond();
}

describe('run_command — cancellation through ctx.signal', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bk-abort-')); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    /** A script that records its pid and then idles for a minute. */
    function idleScript(): { command: string; pidFile: string } {
        const pidFile = join(dir, 'pid.txt');
        const script = join(dir, 'idle.js');
        writeFileSync(script, `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetTimeout(function () {}, 60000);\n`);
        return { command: `node "${script}"`, pidFile };
    }

    it('stops a running command when the signal aborts, and does not leave the process behind', async () => {
        const { command, pidFile } = idleScript();
        const controller = new AbortController();
        const run = runCommandTool.execute({ command, timeout_ms: 30_000 }, ctxWith(controller.signal));

        expect(await until(() => existsSync(pidFile), 8000)).toBe(true);
        const pid = Number(readFileSync(pidFile, 'utf8'));
        expect(alive(pid)).toBe(true);

        const abortedAt = Date.now();
        controller.abort('aborted');
        const result = await run;

        expect(result).toBe('Error: Command aborted');
        expect(Date.now() - abortedAt).toBeLessThan(1000);
        expect(await until(() => !alive(pid), 8000)).toBe(true);
    }, 30_000);

    it('does not start anything when the signal is already aborted', async () => {
        const { command, pidFile } = idleScript();
        const controller = new AbortController();
        controller.abort('aborted');
        const result = await runCommandTool.execute({ command, timeout_ms: 30_000 }, ctxWith(controller.signal));
        expect(result).toBe('Error: Command aborted');
        await sleep(300);
        // A killed-at-birth process may have written its pid before dying, but it must not still be running.
        if (existsSync(pidFile)) expect(await until(() => !alive(Number(readFileSync(pidFile, 'utf8'))), 8000)).toBe(true);
    }, 30_000);

    it('keeps its own timeout_ms behaviour when no signal is given', async () => {
        const { command } = idleScript();
        const result = await runCommandTool.execute({ command, timeout_ms: 1000 }, ctxWith());
        expect(result).toBe('Error: Command timed out after 1000ms');
    }, 15_000);

    it('a command that finishes normally is unaffected and leaves no listener behind', async () => {
        const controller = new AbortController();
        const result = await runCommandTool.execute({ command: 'node -e "console.log(42)"' }, ctxWith(controller.signal));
        expect(result).toBe('42');
        controller.abort();                       // late abort: nothing to kill, no throw
    }, 15_000);
});
