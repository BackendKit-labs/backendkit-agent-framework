import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SandboxDecision, SandboxMode, SandboxNetwork } from '@backendkit-labs/agent-core';
import { createSandboxPolicy, createSandboxService, NoneBackend, type BackendExecRequest, type SandboxBackend } from '../index';

const caller = { agentId: 'coder', sessionId: 's1' };
const here = process.cwd();

/** A scripted backend: records what it was asked and never touches the host. */
function fake(name: string, opts: { modes?: SandboxMode[]; network?: SandboxNetwork[]; up?: boolean; reason?: string } = {}) {
    const calls: BackendExecRequest[] = [];
    const backend: SandboxBackend = {
        name,
        supports: (m, n) => (opts.modes ?? ['read-only', 'workspace-write', 'danger-full-access']).includes(m) && (opts.network ?? ['none', 'allow']).includes(n),
        available: async () => opts.up ?? true,
        unavailableReason: () => opts.reason ?? `${name} is down`,
        exec: async req => { calls.push(req); return { exitCode: 0, output: `ran on ${name}`, timedOut: false, aborted: false }; },
    };
    return { backend, calls };
}

const req = (over = {}) => ({ tool: 'run_command', command: 'echo hi', cwd: here, ...over });

describe('SandboxService — choosing a backend (fail closed)', () => {
    it('uses the first backend that supports the mode and is available', async () => {
        const a = fake('a', { modes: ['danger-full-access'] });
        const b = fake('b');
        const svc = createSandboxService({ policy: createSandboxPolicy({ preset: 'ask' }), backends: [a.backend, b.backend] });
        const out = await svc.run(caller, req());
        expect(out).toMatchObject({ ok: true, backend: 'b', mode: 'workspace-write', network: 'none' });
        expect(a.calls).toHaveLength(0);
        expect(b.calls).toHaveLength(1);
    });

    it('SANDBOX_UNAVAILABLE when the only capable backend is down: nothing runs, the host is never used', async () => {
        const docker = fake('docker', { modes: ['read-only', 'workspace-write'], up: false, reason: 'the docker daemon is not reachable' });
        const host = fake('none', { modes: ['danger-full-access'], network: ['allow'] });
        const svc = createSandboxService({ policy: createSandboxPolicy({ preset: 'ask' }), backends: [docker.backend, host.backend] });
        const out = await svc.run(caller, req());
        expect(out).toMatchObject({ ok: false, code: 'SANDBOX_UNAVAILABLE', mode: 'workspace-write' });
        if (!out.ok) {
            expect(out.reason).toContain('nothing was run');
            expect(out.reason).toContain('docker: the docker daemon is not reachable');
            expect(out.reason).toContain('none: cannot enforce workspace-write');
        }
        expect(docker.calls).toHaveLength(0);
        expect(host.calls).toHaveLength(0);
    });

    it('the real host backend only takes full access with the network open', async () => {
        const none = new NoneBackend();
        expect(none.supports('danger-full-access', 'allow')).toBe(true);
        expect(none.supports('danger-full-access', 'none')).toBe(false);
        expect(none.supports('workspace-write', 'allow')).toBe(false);
        expect(none.supports('read-only', 'none')).toBe(false);

        const svc = createSandboxService({ policy: createSandboxPolicy({ preset: 'ask' }), backends: [none] });
        const out = await svc.run(caller, req());
        expect(out).toMatchObject({ ok: false, code: 'SANDBOX_UNAVAILABLE' });
    });

    it('full access with the network forced closed also fails closed on the host backend', async () => {
        const svc = createSandboxService({ policy: createSandboxPolicy({ preset: 'full', network: 'none' }), backends: [new NoneBackend()] });
        expect(await svc.run(caller, req())).toMatchObject({ ok: false, code: 'SANDBOX_UNAVAILABLE', network: 'none' });
    });

    it('without any backend it reports why instead of running', async () => {
        const out = await createSandboxService({ policy: createSandboxPolicy(), backends: [] }).run(caller, req());
        expect(out).toMatchObject({ ok: false, code: 'SANDBOX_UNAVAILABLE' });
        if (!out.ok) expect(out.reason).toContain('no backends configured');
    });

    it('a backend that throws becomes an error result, not an exception', async () => {
        const boom: SandboxBackend = { name: 'boom', supports: () => true, available: async () => true, exec: async () => { throw new Error('exploded'); } };
        const out = await createSandboxService({ policy: createSandboxPolicy(), backends: [boom] }).run(caller, req());
        expect(out).toMatchObject({ ok: true, result: { error: 'exploded', exitCode: null } });
    });
});

describe('SandboxService — working directory and request details', () => {
    it('denies a working directory outside the workspace and the extra roots', async () => {
        const f = fake('f');
        const svc = createSandboxService({ policy: createSandboxPolicy({ preset: 'ask' }), backends: [f.backend] });
        const out = await svc.run(caller, req({ workspace: join(here, 'a'), cwd: join(here, 'b') }));
        expect(out).toMatchObject({ ok: false, code: 'SANDBOX_DENIED' });
        expect(f.calls).toHaveLength(0);
    });

    it('allows a subdirectory of the workspace, and an extra root from the policy; not a sibling with the same prefix', async () => {
        const f = fake('f');
        const policy = createSandboxPolicy({ preset: 'ask', roots: [join(here, 'extra')] });
        const svc = createSandboxService({ policy, backends: [f.backend] });
        expect((await svc.run(caller, req({ workspace: here, cwd: join(here, 'sub', 'dir') }))).ok).toBe(true);
        expect((await svc.run(caller, req({ workspace: join(here, 'w'), cwd: join(here, 'extra', 'x') }))).ok).toBe(true);
        expect((await svc.run(caller, req({ workspace: join(here, 'w'), cwd: join(here, 'w-evil') }))).ok).toBe(false);
    });

    it('full access does not check the working directory', async () => {
        const f = fake('f');
        const svc = createSandboxService({ policy: createSandboxPolicy({ preset: 'full' }), backends: [f.backend] });
        expect((await svc.run(caller, req({ workspace: join(here, 'a'), cwd: join(here, 'elsewhere') }))).ok).toBe(true);
    });

    it('hands the backend the command, the host command, the limits and the scrubbed environment', async () => {
        const f = fake('f');
        const controller = new AbortController();
        const onOutput = () => undefined;
        const svc = createSandboxService({
            policy: createSandboxPolicy({ preset: 'ask', env: { allow: ['GH_TOKEN'] } }), backends: [f.backend],
            baseEnv: { PATH: '/bin', DEEPSEEK_API_KEY: 'secret', GH_TOKEN: 'gh', UNDEFINED_ONE: undefined },
        });
        await svc.run(caller, req({ command: 'ls', hostCommand: 'dir', timeoutMs: 500, signal: controller.signal, onOutput }));
        expect(f.calls[0]).toMatchObject({ command: 'ls', hostCommand: 'dir', timeoutMs: 500, mode: 'workspace-write', network: 'none', env: { PATH: '/bin', GH_TOKEN: 'gh' } });
        expect(f.calls[0].env.DEEPSEEK_API_KEY).toBeUndefined();
        expect(f.calls[0].signal).toBe(controller.signal);
        expect(f.calls[0].onOutput).toBe(onOutput);
    });

    it('omits hostCommand when the tool did not give one', async () => {
        const f = fake('f');
        await createSandboxService({ policy: createSandboxPolicy(), backends: [f.backend] }).run(caller, req());
        expect('hostCommand' in f.calls[0]).toBe(false);
    });
});

describe('SandboxService — real processes on the host backend', () => {
    it('a secret in the environment never reaches the command (full access, host backend)', async () => {
        process.env.BK_TEST_FAKE_API_KEY = 'should-not-leak';
        process.env.BK_TEST_PLAIN = 'visible';
        try {
            const svc = createSandboxService({ policy: createSandboxPolicy({ preset: 'full' }), backends: [new NoneBackend()] });
            const out = await svc.run(caller, req({
                command: `"${process.execPath}" -e "console.log((process.env.BK_TEST_FAKE_API_KEY||'absent')+'/'+(process.env.BK_TEST_PLAIN||'missing'))"`,
                timeoutMs: 15_000,
            }));
            expect(out.ok).toBe(true);
            if (out.ok) {
                expect(out.backend).toBe('none');
                expect(out.result.exitCode).toBe(0);
                expect(out.result.output.trim()).toBe('absent/visible');
            }
        } finally { delete process.env.BK_TEST_FAKE_API_KEY; delete process.env.BK_TEST_PLAIN; }
    }, 30_000);

    it('streams output, reports exit codes and honours the timeout through the service', async () => {
        const svc = createSandboxService({ policy: createSandboxPolicy({ preset: 'full' }), backends: [new NoneBackend()] });
        const seen: string[] = [];
        const ok = await svc.run(caller, req({ command: `"${process.execPath}" -e "console.log('streamed'); process.exit(4)"`, onOutput: (c: string) => seen.push(c) }));
        expect(ok.ok && ok.result.exitCode).toBe(4);
        expect(seen.join('')).toContain('streamed');

        const slow = await svc.run(caller, req({ command: `"${process.execPath}" -e "setTimeout(()=>{},60000)"`, timeoutMs: 400 }));
        expect(slow.ok && slow.result.timedOut).toBe(true);
    }, 30_000);
});

describe('SandboxService — decisions, audit and authorizeTool', () => {
    it('reports every decision to listeners; a throwing listener does not matter; unsubscribe works', async () => {
        const f = fake('f', { modes: ['workspace-write'] });
        const svc = createSandboxService({ policy: createSandboxPolicy({ preset: 'ask' }), backends: [f.backend] });
        const seen: SandboxDecision[] = [];
        svc.onDecision(() => { throw new Error('bad observer'); });
        const off = svc.onDecision(d => seen.push(d));

        await svc.run(caller, req());
        svc.policy.set({ preset: 'full' });
        await svc.run(caller, req());
        off();
        await svc.run(caller, req());

        expect(seen.map(d => d.outcome)).toEqual(['allowed', 'SANDBOX_UNAVAILABLE']);
        expect(seen[0]).toMatchObject({ agentId: 'coder', sessionId: 's1', tool: 'run_command', mode: 'workspace-write', network: 'none', backend: 'f' });
        expect(seen[1].reason).toContain('nothing was run');
    });

    it('writes decisions to an NDJSON audit log', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'bk-audit-'));
        try {
            const file = join(dir, 'nested', 'sandbox.ndjson');
            const f = fake('f');
            const svc = createSandboxService({ policy: createSandboxPolicy(), backends: [f.backend], auditLog: file });
            await svc.run(caller, req());
            await svc.run(caller, req({ workspace: join(here, 'a'), cwd: join(here, 'b') }));
            for (let i = 0; i < 40; i++) { try { if (readFileSync(file, 'utf8').trim().split('\n').length >= 2) break; } catch { /* not yet */ } await new Promise(r => setTimeout(r, 25)); }
            const lines = readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
            expect(lines.map(l => l.outcome)).toEqual(['allowed', 'SANDBOX_DENIED']);
            expect(lines[0]).toMatchObject({ agentId: 'coder', tool: 'run_command', backend: 'f' });
            expect(typeof lines[0].ts).toBe('string');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('a policy change applies to the next call, never to one already running', async () => {
        let release!: () => void;
        const gate = new Promise<void>(r => { release = r; });
        const seenModes: SandboxMode[] = [];
        const slow: SandboxBackend = {
            name: 'slow', supports: () => true, available: async () => true,
            exec: async r => { seenModes.push(r.mode); await gate; return { exitCode: 0, output: '', timedOut: false, aborted: false }; },
        };
        const svc = createSandboxService({ policy: createSandboxPolicy({ preset: 'read-only' }), backends: [slow] });
        const first = svc.run(caller, req());
        await new Promise(r => setTimeout(r, 20));
        svc.policy.set({ preset: 'full' });
        release();
        const out = await first;
        expect(out).toMatchObject({ ok: true, mode: 'read-only' });
        await svc.run(caller, req());
        expect(seenModes).toEqual(['read-only', 'danger-full-access']);
    });

    it('authorizeTool refuses listed write tools only while read-only, and records the refusal', () => {
        const svc = createSandboxService({
            policy: createSandboxPolicy({ preset: 'read-only', writeTools: ['write_file', 'edit_file'], rules: [{ agentId: 'builder', mode: 'workspace-write' }] }),
            backends: [],
        });
        const seen: SandboxDecision[] = [];
        svc.onDecision(d => seen.push(d));

        expect(svc.authorizeTool!(caller, 'read_file')).toEqual({ ok: true });
        const denied = svc.authorizeTool!(caller, 'write_file');
        expect(denied).toMatchObject({ ok: false, code: 'SANDBOX_DENIED' });
        expect(svc.authorizeTool!({ agentId: 'builder', sessionId: 's' }, 'write_file')).toEqual({ ok: true });
        expect(seen.map(d => [d.tool, d.outcome])).toEqual([['write_file', 'SANDBOX_DENIED']]);
    });
});

describe('SandboxService — approvalFor and environment switch', () => {
    const svcFor = (cfg: Parameters<typeof createSandboxPolicy>[0]) =>
        createSandboxService({ policy: createSandboxPolicy(cfg), backends: [] });

    it('maps the approval level to ask / none by the kind of tool', () => {
        const writes = ['write_file', 'edit_file'];
        const ask = svcFor({ preset: 'ask', writeTools: writes });
        expect(ask.approvalFor!(caller, 'run_command')).toBe('ask');
        expect(ask.approvalFor!(caller, 'write_file')).toBe('ask');
        expect(ask.approvalFor!(caller, 'read_file')).toBe('none');

        const autoEdit = svcFor({ preset: 'auto-edit', writeTools: writes });
        expect(autoEdit.approvalFor!(caller, 'run_command')).toBe('ask');
        expect(autoEdit.approvalFor!(caller, 'write_file')).toBe('none');

        for (const preset of ['read-only', 'full'] as const) {
            expect(svcFor({ preset, writeTools: writes }).approvalFor!(caller, 'run_command')).toBe('none');
        }
    });

    it('commandTools decides what counts as a command; the default is run_command', () => {
        expect(svcFor({ preset: 'auto-edit' }).approvalFor!(caller, 'shell')).toBe('none');
        expect(svcFor({ preset: 'auto-edit', commandTools: ['shell'] }).approvalFor!(caller, 'shell')).toBe('ask');
        expect(svcFor({ preset: 'auto-edit', commandTools: ['shell'] }).approvalFor!(caller, 'run_command')).toBe('none');
    });

    it('approval follows a policy change and per-agent rules', () => {
        const svc = svcFor({ preset: 'ask', rules: [{ agentId: 'trusted', mode: 'danger-full-access' }] });
        expect(svc.approvalFor!(caller, 'run_command')).toBe('ask');
        // rules change the MODE; the approval level stays the preset's unless set explicitly
        expect(svc.approvalFor!({ agentId: 'trusted', sessionId: 's' }, 'run_command')).toBe('ask');
        svc.policy.set({ preset: 'full' });
        expect(svc.approvalFor!(caller, 'run_command')).toBe('none');
    });

    it('scrubEnvironment:false hands the command the whole environment (legacy behaviour)', async () => {
        const f = fake('f');
        const svc = createSandboxService({
            policy: createSandboxPolicy({ preset: 'ask' }), backends: [f.backend],
            baseEnv: { PATH: '/bin', DEEPSEEK_API_KEY: 'secret', GONE: undefined }, scrubEnvironment: false,
        });
        await svc.run(caller, req());
        expect(f.calls[0].env).toEqual({ PATH: '/bin', DEEPSEEK_API_KEY: 'secret' });
    });
});

describe('SandboxService — audit log failures are not silent', () => {
    it('reports a line that could not be written, and the call still goes through', async () => {
        const f = fake('fake');
        const dir = mkdtempSync(join(tmpdir(), 'sbx-audit-'));
        const errors: Array<{ error: unknown; line: string }> = [];
        try {
            // The log path is a directory: appendFile fails.
            const svc = createSandboxService({
                policy: createSandboxPolicy({ preset: 'full' }), backends: [f.backend], auditLog: dir,
                onAuditError: (error, line) => errors.push({ error, line }),
            });
            const out = await svc.run(caller, req());
            await new Promise((r) => setTimeout(r, 50));
            expect(out.ok).toBe(true);
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0].line).toContain('"outcome"');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('warns once on stderr by default', async () => {
        const f = fake('fake');
        const dir = mkdtempSync(join(tmpdir(), 'sbx-audit-'));
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            const svc = createSandboxService({ policy: createSandboxPolicy({ preset: 'full' }), backends: [f.backend], auditLog: dir });
            await svc.run(caller, req());
            await svc.run(caller, req());
            await new Promise((r) => setTimeout(r, 50));
            expect(warn).toHaveBeenCalledTimes(1);
        } finally { warn.mockRestore(); rmSync(dir, { recursive: true, force: true }); }
    });
});
