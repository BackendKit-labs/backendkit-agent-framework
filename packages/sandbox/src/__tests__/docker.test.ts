import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDockerArgs, createSandboxPolicy, createSandboxService, DockerBackend, type SandboxService } from '../index';

const caller = { agentId: 'coder', sessionId: 's1' };

describe('buildDockerArgs', () => {
    const opts = { image: 'node:22', memory: '2g', pidsLimit: 512 };
    const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];

    it('drops every capability, forbids new privileges and sets the limits', () => {
        const a = buildDockerArgs('c1', { command: 'ls', cwd: '/w', workspace: '/w', mode: 'workspace-write', network: 'none' }, opts);
        expect(flag(a, '--cap-drop')).toBe('ALL');
        expect(flag(a, '--security-opt')).toBe('no-new-privileges');
        expect(flag(a, '--memory')).toBe('2g');
        expect(flag(a, '--pids-limit')).toBe('512');
        expect(flag(a, '--name')).toBe('c1');
        expect(a.slice(-3)).toEqual(['sh', '-c', 'ls']);
        expect(a[a.indexOf('node:22') - 1]).toBe('/workspace');   // image comes right after -w <dir>
    });

    it('mounts the workspace read-write in workspace-write and read-only (with a read-only root) in read-only', () => {
        const rw = buildDockerArgs('c', { command: 'x', cwd: '/w', workspace: '/w', mode: 'workspace-write', network: 'none' }, opts);
        expect(flag(rw, '-v')).toBe('/w:/workspace');
        expect(rw).not.toContain('--read-only');

        const ro = buildDockerArgs('c', { command: 'x', cwd: '/w', workspace: '/w', mode: 'read-only', network: 'none' }, opts);
        expect(flag(ro, '-v')).toBe('/w:/workspace:ro');
        expect(ro).toContain('--read-only');
        expect(flag(ro, '--tmpfs')).toBe('/tmp');
    });

    it('runs as the given user, and leaves the image default when none is given', () => {
        const base = { command: 'x', cwd: '/w', workspace: '/w', mode: 'workspace-write' as const, network: 'none' as const };
        expect(flag(buildDockerArgs('c', base, { ...opts, user: '1001:1002' }), '--user')).toBe('1001:1002');
        expect(buildDockerArgs('c', base, opts)).not.toContain('--user');
    });

    it('closes the network unless the policy allows it', () => {
        const base = { command: 'x', cwd: '/w', workspace: '/w', mode: 'workspace-write' as const };
        expect(flag(buildDockerArgs('c', { ...base, network: 'none' }, opts), '--network')).toBe('none');
        expect(flag(buildDockerArgs('c', { ...base, network: 'allow' }, opts), '--network')).toBe('bridge');
    });

    it('runs in the matching subdirectory of the mount', () => {
        const a = buildDockerArgs('c', { command: 'x', cwd: join('/w', 'packages', 'api'), workspace: '/w', mode: 'workspace-write', network: 'none' }, opts);
        expect(flag(a, '-w')).toBe('/workspace/packages/api');
    });
});

describe('DockerBackend — what it claims and when it is available', () => {
    it('supports read-only and workspace-write, never danger-full-access', () => {
        const d = new DockerBackend();
        expect(d.supports('read-only', 'none')).toBe(true);
        expect(d.supports('workspace-write', 'allow')).toBe(true);
        expect(d.supports('danger-full-access', 'allow')).toBe(false);
    });

    it('chooses the user: host uid:gid on POSIX, explicit value, or none', () => {
        const hostUser = typeof process.getuid === 'function' ? `${process.getuid()}:${process.getgid!()}` : undefined;
        expect((new DockerBackend() as unknown as { user?: string }).user).toBe(hostUser);
        expect((new DockerBackend({ user: '5:6' }) as unknown as { user?: string }).user).toBe('5:6');
        expect((new DockerBackend({ user: false }) as unknown as { user?: string }).user).toBeUndefined();
    });

    it('probes once while the answer is positive, and again after the negative ttl', async () => {
        let up = false;
        let probes = 0;
        const d = new DockerBackend({ probe: async () => { probes++; return up; }, negativeTtlMs: 40 });
        expect(await d.available()).toBe(false);
        expect(await d.available()).toBe(false);          // cached negative
        expect(probes).toBe(1);
        await new Promise(r => setTimeout(r, 60));
        up = true;
        expect(await d.available()).toBe(true);           // asks again, daemon is up now
        expect(await d.available()).toBe(true);
        expect(probes).toBe(2);
    });

    it('a probe that throws counts as unavailable', async () => {
        const d = new DockerBackend({ probe: async () => { throw new Error('boom'); } });
        expect(await d.available()).toBe(false);
        expect(d.unavailableReason()).toContain('docker daemon');
    });

    it('a docker CLI that does not exist is unavailable, and the service then refuses instead of using the host', async () => {
        const d = new DockerBackend({ bin: 'definitely-not-docker-xyz' });
        expect(await d.available()).toBe(false);
        const svc = createSandboxService({ policy: createSandboxPolicy({ preset: 'ask' }), backends: [d] });
        const out = await svc.run(caller, { tool: 'run_command', command: 'echo hi', cwd: process.cwd() });
        expect(out).toMatchObject({ ok: false, code: 'SANDBOX_UNAVAILABLE' });
    }, 20_000);
});

// ── The confinement matrix, against a real docker daemon ────────────────────────────────────────────
// Locally these are skipped when docker is not running. In CI (CI=true) a missing daemon FAILS the run,
// so the matrix can never be silently skipped there.

const IMAGE = process.env.BK_SANDBOX_TEST_IMAGE ?? 'alpine:3.20';
const dockerUp = (() => {
    try { execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'ignore', timeout: 15_000 }); return true; }
    catch { return false; }
})();

if (process.env.CI && !dockerUp) {
    it('docker is required in CI for the confinement matrix', () => { throw new Error('CI=true but no docker daemon answers: the sandbox matrix would not run'); });
}

(dockerUp ? describe : describe.skip)('DockerBackend — real confinement', () => {
    let dir: string;
    let svc: SandboxService;
    const setup = (preset: 'read-only' | 'ask', extra = {}) => {
        svc = createSandboxService({
            policy: createSandboxPolicy({ preset, ...extra }),
            backends: [new DockerBackend({ image: IMAGE })],
        });
    };
    const run = (command: string, over: Record<string, unknown> = {}) =>
        svc.run(caller, { tool: 'run_command', command, cwd: dir, workspace: dir, timeoutMs: 60_000, ...over });

    beforeAll(() => { execFileSync('docker', ['pull', '-q', IMAGE], { stdio: 'ignore', timeout: 240_000 }); }, 260_000);
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bk-dkr-')); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it('workspace-write: can write inside the workspace and the file shows up on the host', async () => {
        setup('ask');
        const out = await run('echo hello > inside.txt && cat inside.txt');
        expect(out).toMatchObject({ ok: true, backend: 'docker', mode: 'workspace-write' });
        if (out.ok) { expect(out.result.exitCode).toBe(0); expect(out.result.output).toContain('hello'); }
        expect(existsSync(join(dir, 'inside.txt'))).toBe(true);
    }, 90_000);

    it('workspace-write: cannot write outside the workspace on the host (the container root is not the host)', async () => {
        setup('ask');
        const marker = join(dir, '..', `bk-outside-${Date.now()}.txt`);
        const out = await run('echo x > /etc/bk-escape.txt; echo x > /workspace/../bk-escape.txt; ls /workspace');
        expect(out.ok).toBe(true);
        expect(existsSync(marker)).toBe(false);
        expect(existsSync(join(dir, '..', 'bk-escape.txt'))).toBe(false);
    }, 90_000);

    it('read-only: nothing can be written, not in the workspace and not at the container root', async () => {
        writeFileSync(join(dir, 'existing.txt'), 'original');
        setup('read-only');
        const out = await run('echo changed > existing.txt; echo n > new.txt; echo r > /root-file.txt; cat existing.txt');
        expect(out).toMatchObject({ ok: true, mode: 'read-only', network: 'none' });
        if (out.ok) expect(out.result.output).toContain('original');
        expect(existsSync(join(dir, 'new.txt'))).toBe(false);
        expect(require('node:fs').readFileSync(join(dir, 'existing.txt'), 'utf8')).toBe('original');
    }, 90_000);

    it('the network is closed by default and open when the policy says so', async () => {
        setup('ask');
        const closed = await run('wget -q -T 3 -O- http://1.1.1.1 >/dev/null 2>&1; echo "exit=$?"');
        expect(closed.ok && closed.result.output).toContain('exit=1');   // busybox wget: 1 = could not connect
        const iface = await run('cat /proc/net/dev | grep -c eth0 || true');
        expect(iface.ok && iface.result.output.trim()).toBe('0');        // no eth0: --network none

        setup('ask', { network: 'allow' });
        const open = await run('cat /proc/net/dev | grep -c eth0 || true');
        expect(open.ok && open.result.output.trim()).toBe('1');
    }, 120_000);

    it('the host environment does not reach the container', async () => {
        process.env.BK_TEST_DOCKER_SECRET_KEY = 'host-secret';
        try {
            setup('ask');
            const out = await run('printenv BK_TEST_DOCKER_SECRET_KEY || echo absent');
            expect(out.ok && out.result.output.trim()).toBe('absent');
        } finally { delete process.env.BK_TEST_DOCKER_SECRET_KEY; }
    }, 90_000);

    it('aborting a long command removes the container', async () => {
        setup('ask');
        const controller = new AbortController();
        const pending = run('sleep 120', { signal: controller.signal, timeoutMs: undefined });
        const listBk = () => execFileSync('docker', ['ps', '-q', '--filter', 'name=bk-run-'], { encoding: 'utf8' }).trim();
        const t0 = Date.now();
        while (!listBk() && Date.now() - t0 < 60_000) await new Promise(r => setTimeout(r, 250));
        expect(listBk()).not.toBe('');

        controller.abort();
        const out = await pending;
        expect(out.ok && out.result.aborted).toBe(true);
        const t1 = Date.now();
        while (listBk() && Date.now() - t1 < 30_000) await new Promise(r => setTimeout(r, 250));
        expect(listBk()).toBe('');
    }, 150_000);

    it('streams output while the command runs and reports the exit code', async () => {
        setup('ask');
        const seen: string[] = [];
        const out = await run('echo first; sleep 1; echo second; exit 3', { onOutput: (c: string) => seen.push(c) });
        expect(out.ok && out.result.exitCode).toBe(3);
        expect(seen.join('')).toContain('first');
        expect(seen.join('')).toContain('second');
    }, 90_000);
});
