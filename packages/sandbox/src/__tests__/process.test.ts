import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from '../process';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(cond: () => boolean, ms: number): Promise<boolean> {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (cond()) return true; await sleep(25); }
    return cond();
}
const node = (code: string) => spawn(process.execPath, ['-e', code], { stdio: 'pipe', detached: process.platform !== 'win32' });

describe('runProcess', () => {
    it('collects stdout and stderr interleaved in arrival order, and the exit code', async () => {
        const proc = node(`
            const w = (s, t) => new Promise(r => setTimeout(() => { s.write(t); r(); }, 60));
            (async () => { await w(process.stdout, 'one\\n'); await w(process.stderr, 'two\\n'); await w(process.stdout, 'three\\n'); process.exit(3); })();
        `);
        const r = await runProcess(proc);
        expect(r.output.replace(/\r/g, '')).toBe('one\ntwo\nthree\n');
        expect(r).toMatchObject({ exitCode: 3, timedOut: false, aborted: false });
        expect(r.error).toBeUndefined();
    }, 15_000);

    it('streams every chunk to onOutput even when the stored output is capped', async () => {
        const seen: string[] = [];
        const proc = node(`for (let i = 0; i < 5; i++) process.stdout.write('x'.repeat(100) + '\\n');`);
        const r = await runProcess(proc, { maxOutputChars: 150, onOutput: c => seen.push(c) });
        expect(seen.join('').replace(/\r/g, '').length).toBe(5 * 101);
        expect(r.output.length).toBeLessThan(seen.join('').length);
        expect(r.output.length).toBeGreaterThanOrEqual(100);
    }, 15_000);

    it('reports a timeout and kills the process', async () => {
        const proc = node(`setTimeout(() => {}, 60000)`);
        const t0 = Date.now();
        const r = await runProcess(proc, { timeoutMs: 300 });
        expect(r).toMatchObject({ timedOut: true, aborted: false, exitCode: null });
        expect(Date.now() - t0).toBeLessThan(3000);
        expect(await until(() => !alive(proc.pid!), 8000)).toBe(true);
    }, 20_000);

    it('reports an abort quickly and leaves no process behind, children included', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'bk-sbx-'));
        try {
            const childPid = join(dir, 'child.pid');
            const script = join(dir, 'parent.js');
            const childScript = join(dir, 'child.js');
            writeFileSync(childScript, `require('fs').writeFileSync(${JSON.stringify(childPid)}, String(process.pid)); setTimeout(() => {}, 60000);`);
            writeFileSync(script, `
                const { spawn } = require('child_process');
                spawn(process.execPath, [${JSON.stringify(childScript)}], { stdio: 'ignore' });
                setTimeout(() => {}, 60000);
            `);
            const proc = spawn(`"${process.execPath}" "${script}"`, { shell: true, detached: process.platform !== 'win32', stdio: 'pipe' });
            const controller = new AbortController();
            const run = runProcess(proc, { signal: controller.signal });

            expect(await until(() => existsSync(childPid), 8000)).toBe(true);
            const grandchild = Number(readFileSync(childPid, 'utf8'));
            expect(alive(grandchild)).toBe(true);

            const at = Date.now();
            controller.abort();
            const r = await run;
            expect(r).toMatchObject({ aborted: true, timedOut: false });
            expect(Date.now() - at).toBeLessThan(1000);
            expect(await until(() => !alive(grandchild), 8000)).toBe(true);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    }, 30_000);

    it('an already aborted signal stops the command at once: it is gone long before it would have done anything', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'bk-sbx-'));
        try {
            const marker = join(dir, 'ran.txt');
            // Would write the marker after 4 s. The kill is asynchronous (taskkill on Windows), so allow it time under load.
            const proc = node(`setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'), 4000)`);
            const controller = new AbortController();
            controller.abort();
            const r = await runProcess(proc, { signal: controller.signal });
            expect(r.aborted).toBe(true);
            expect(await until(() => !alive(proc.pid!), 3500)).toBe(true);
            await sleep(700);
            expect(existsSync(marker)).toBe(false);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    }, 20_000);

    it('a command that cannot start comes back as an error, not a throw', async () => {
        const proc = spawn('definitely-not-a-binary-xyz', [], { stdio: 'pipe' });
        const r = await runProcess(proc);
        expect(r.error).toMatch(/ENOENT|not found/i);
        expect(r.exitCode).toBeNull();
    }, 10_000);

    it('a late abort after the process ended changes nothing', async () => {
        const controller = new AbortController();
        const r = await runProcess(node(`console.log(42)`), { signal: controller.signal });
        controller.abort();
        expect(r).toMatchObject({ exitCode: 0, aborted: false });
        expect(r.output.trim()).toBe('42');
    }, 10_000);
});

describe('runProcess — multibyte output split across chunks', () => {
    it('does not corrupt a character cut between two writes', async () => {
        // "é" is 0xC3 0xA9: write the two bytes with a pause between them.
        const proc = spawn(process.execPath, ['-e',
            "process.stdout.write(Buffer.from([0x68,0xC3])); setTimeout(()=>process.stdout.write(Buffer.from([0xA9,0x21])),80)"]);
        const out = await runProcess(proc, { timeoutMs: 10_000 });
        expect(out.output).toBe('hé!');
    });
});
