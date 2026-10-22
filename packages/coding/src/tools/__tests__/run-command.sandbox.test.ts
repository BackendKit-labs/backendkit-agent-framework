import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createJobRegistry, type SandboxExecRequest, type SandboxOutcome, type SandboxRunner } from '@backendkit-labs/agent-core';
import { createSandboxPolicy, createSandboxService, DockerBackend, NoneBackend } from '@backendkit-labs/agent-sandbox';
import { runCommandTool } from '../run-command';

const baseCtx = {
    agentId: 'coder', sessionId: 's1', workingDir: process.cwd(),
    memory: { get: () => undefined, set: () => undefined, getAll: () => ({}) },
    askAgent: async () => '',
};

/** A runner that answers with a fixed outcome and remembers what it was asked. */
function runnerReturning(outcome: Partial<Extract<SandboxOutcome, { ok: true }>['result']> | Extract<SandboxOutcome, { ok: false }>, backend = 'none') {
    const requests: Array<{ caller: { agentId: string; sessionId: string }; req: SandboxExecRequest }> = [];
    const runner: SandboxRunner = {
        async run(caller, req) {
            requests.push({ caller, req });
            if ('code' in outcome) return outcome;
            return { ok: true, mode: 'workspace-write', network: 'none', backend, result: { exitCode: 0, output: '', timedOut: false, aborted: false, ...outcome } };
        },
    };
    return { runner, requests };
}
const run = (runner: SandboxRunner, input: Record<string, unknown>, ctx: Record<string, unknown> = {}) =>
    runCommandTool.execute({ timeout_ms: 30_000, ...input } as never, { ...baseCtx, sandbox: runner, ...ctx });

describe('run_command through ctx.sandbox', () => {
    it('hands the sandbox the caller, the command and the directories, and uses its answer', async () => {
        const { runner, requests } = runnerReturning({ output: 'hello\n' });
        const controller = new AbortController();
        const out = await run(runner, { command: 'echo hello', timeout_ms: 5000 }, { signal: controller.signal });

        expect(out).toBe('hello');
        expect(requests).toHaveLength(1);
        const { caller, req } = requests[0];
        expect(caller).toEqual({ agentId: 'coder', sessionId: 's1' });
        expect(req).toMatchObject({ tool: 'run_command', command: 'echo hello', cwd: process.cwd(), workspace: process.cwd(), timeoutMs: 5000 });
        expect(req.signal).toBe(controller.signal);
    });

    it('keeps the portable command for containers and the Windows-adjusted one for the host shell', async () => {
        const { runner, requests } = runnerReturning({ output: 'x' });
        await run(runner, { command: 'pwd' });
        expect(requests[0].req.command).toBe('pwd');
        expect(requests[0].req.hostCommand).toBe(process.platform === 'win32' ? 'echo %cd%' : 'pwd');
    });

    it('resolves a cwd inside the workspace and refuses one outside before asking the sandbox', async () => {
        const { runner, requests } = runnerReturning({ output: 'x' });
        await run(runner, { command: 'echo a', cwd: 'src' });
        expect(requests[0].req.cwd).toBe(join(process.cwd(), 'src'));
        const out = await run(runner, { command: 'echo a', cwd: '../../..' });
        expect(out).toMatch(/^Error: Access denied/);
        expect(requests).toHaveLength(1);
    });

    it('maps every kind of result to the same strings as before', async () => {
        expect(await run(runnerReturning({ exitCode: 0, output: '' }).runner, { command: 'echo ok' })).toBe('(no output)');
        expect(await run(runnerReturning({ exitCode: 3, output: '' }).runner, { command: 'echo ok' })).toBe('Error: Command exited with status 3');
        expect(await run(runnerReturning({ exitCode: 3, output: 'partial' }).runner, { command: 'echo x' })).toBe('partial');
        expect(await run(runnerReturning({ timedOut: true, exitCode: null }).runner, { command: 'echo x', timeout_ms: 1500 })).toBe('Error: Command timed out after 1500ms');
        expect(await run(runnerReturning({ aborted: true, exitCode: null }).runner, { command: 'echo x' })).toBe('Error: Command aborted');
        expect(await run(runnerReturning({ error: 'spawn failed', exitCode: null }).runner, { command: 'echo x' })).toBe('Error: spawn failed');
    });

    it('a non-zero exit from a confining backend is reported as a sandboxed failure with its output', async () => {
        const { runner } = runnerReturning({ exitCode: 2, output: 'boom' }, 'docker');
        expect(await run(runner, { command: 'echo x' })).toBe('Error: sandboxed command exited with status 2\nboom');
    });

    it('truncates long output at 20000 characters and says how long it was', async () => {
        const { runner } = runnerReturning({ output: 'x'.repeat(25_000) });
        const out = await run(runner, { command: 'echo x' });
        expect(out.length).toBeLessThan(25_000);
        expect(out).toContain('[truncated — 25000 total chars]');
    });

    it.each([
        ['SANDBOX_UNAVAILABLE', 'cannot enforce workspace-write on this host; nothing was run'],
        ['SANDBOX_DENIED', 'working directory is outside the allowed roots'],
    ] as const)('a %s answer comes back as an error naming the code and the reason', async (code, reason) => {
        const { runner } = runnerReturning({ ok: false, code, reason, mode: 'workspace-write', network: 'none' });
        expect(await run(runner, { command: 'echo hi' })).toBe(`Error: ${code}: ${reason}`);
    });
});

describe('run_command in the background through ctx.sandbox', () => {
    const settle = async (jobs: ReturnType<typeof createJobRegistry>, id: string) => {
        for (let i = 0; i < 200 && jobs.get(id, 'coder')?.status === 'running'; i++) await new Promise(r => setTimeout(r, 10));
        return jobs.get(id, 'coder')!;
    };

    it('streams output into the job and ends done on exit 0', async () => {
        const jobs = createJobRegistry();
        const runner: SandboxRunner = {
            async run(_c, req) {
                req.onOutput?.('line 1\n'); req.onOutput?.('line 2\n');
                expect(req.timeoutMs).toBeUndefined();
                return { ok: true, mode: 'workspace-write', network: 'none', backend: 'fake', result: { exitCode: 0, output: '', timedOut: false, aborted: false } };
            },
        };
        const started = await run(runner, { command: 'echo long', background: true }, { jobs });
        expect(started).toContain('bash-1');
        expect((await settle(jobs, 'bash-1')).status).toBe('done');
        expect((await jobs.output('bash-1', 'coder')).text).toBe('line 1\nline 2\n');
    });

    it('ends failed with the exit code, or with the sandbox refusal', async () => {
        const jobs = createJobRegistry();
        await run(runnerReturning({ exitCode: 4 }).runner, { command: 'echo x', background: true }, { jobs });
        const failing = await settle(jobs, 'bash-1');
        expect(failing).toMatchObject({ status: 'failed', summary: 'exit 4' });

        const refused = runnerReturning({ ok: false, code: 'SANDBOX_UNAVAILABLE', reason: 'docker is down', mode: 'workspace-write', network: 'none' });
        await run(refused.runner, { command: 'echo x', background: true }, { jobs });
        expect(await settle(jobs, 'bash-2')).toMatchObject({ status: 'failed', summary: 'SANDBOX_UNAVAILABLE: docker is down' });
    });
});

describe('run_command with a real sandbox service', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bk-rc-sbx-')); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it('FAILS CLOSED: with docker down it reports SANDBOX_UNAVAILABLE and the command never runs on the host', async () => {
        const marker = join(dir, 'ran.txt');
        const sandbox = createSandboxService({
            policy: createSandboxPolicy({ preset: 'ask' }),
            // The host backend is present, as in the default setup: it must still not be used for workspace-write.
            backends: [new DockerBackend({ probe: async () => false }), new NoneBackend()],
        });
        const out = await run(sandbox, { command: `node -e "require('fs').writeFileSync(process.argv[1],'x')" "${marker.replace(/\\/g, '/')}"` }, { workingDir: dir });
        expect(out).toMatch(/^Error: SANDBOX_UNAVAILABLE: cannot enforce workspace-write/);
        await new Promise(r => setTimeout(r, 500));
        expect(existsSync(marker)).toBe(false);
    }, 20_000);

    it('full access on the host backend runs the command, with credential-looking variables removed from its environment', async () => {
        process.env.BK_TEST_RC_SECRET_TOKEN = 'must-not-leak';
        try {
            const sandbox = createSandboxService({ policy: createSandboxPolicy({ preset: 'full' }), backends: [new NoneBackend()] });
            const out = await run(sandbox, { command: `node -e "console.log(process.env.BK_TEST_RC_SECRET_TOKEN || 'absent')"` }, { workingDir: dir });
            expect(out).toBe('absent');
        } finally { delete process.env.BK_TEST_RC_SECRET_TOKEN; }
    }, 20_000);

    it('without a configured sandbox the legacy path still passes the whole environment (nothing changes for existing users)', async () => {
        process.env.BK_TEST_RC_LEGACY_TOKEN = 'still-visible';
        try {
            const out = await runCommandTool.execute({ command: `node -e "console.log(process.env.BK_TEST_RC_LEGACY_TOKEN || 'absent')"`, timeout_ms: 20_000 }, { ...baseCtx, workingDir: dir });
            expect(out).toBe('still-visible');
        } finally { delete process.env.BK_TEST_RC_LEGACY_TOKEN; }
    }, 30_000);
});
