import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { SandboxDecision } from '@backendkit-labs/agent-core';
import { createSandboxPolicy, createSandboxService, isInsideDir, realPathOf } from '../index';
import { NoneBackend } from '../backends/none';

const caller = { agentId: 'coder', sessionId: 's1' };

/** A directory link: a junction on Windows (needs no privileges), a symlink elsewhere. Returns false when the OS refuses. */
function link(target: string, path: string): boolean {
    try { symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir'); return true; }
    catch (err) { if ((err as NodeJS.ErrnoException).code === 'EPERM') return false; throw err; }
}

describe('file access through the sandbox', () => {
    let root: string;
    let workspace: string;
    let outside: string;
    beforeEach(() => {
        root = realpathSync(mkdtempSync(join(tmpdir(), 'bk-paths-')));
        workspace = join(root, 'ws');
        outside = join(root, 'outside');
        mkdirSync(workspace); mkdirSync(outside);
        writeFileSync(join(outside, 'secret.txt'), 'secret');
    });
    afterEach(() => { rmSync(root, { recursive: true, force: true }); });

    const serviceFor = (preset: 'read-only' | 'ask' | 'full', extra: Record<string, unknown> = {}) => {
        const service = createSandboxService({ policy: createSandboxPolicy({ preset, ...extra }), backends: [new NoneBackend()] });
        const decisions: SandboxDecision[] = [];
        service.onDecision(d => decisions.push(d));
        return { service, decisions };
    };
    const ask = (service: ReturnType<typeof serviceFor>['service'], path: string, access: 'read' | 'write', extraRoots?: string[]) =>
        service.authorizePath!(caller, { tool: 'write_file', path, access, workspace, ...(extraRoots ? { extraRoots } : {}) });

    it('allows paths inside the workspace, existing or not', () => {
        const { service } = serviceFor('ask');
        expect(ask(service, join(workspace, 'a.txt'), 'write')).toEqual({ ok: true });
        expect(ask(service, join(workspace, 'deep', 'er', 'a.txt'), 'write')).toEqual({ ok: true });
        expect(ask(service, workspace, 'read')).toEqual({ ok: true });
    });

    it('refuses a path outside the workspace', () => {
        const { service, decisions } = serviceFor('ask');
        const v = ask(service, join(outside, 'secret.txt'), 'read');
        expect(v).toMatchObject({ ok: false, code: 'SANDBOX_DENIED' });
        expect(decisions).toHaveLength(1);
        expect(decisions[0]).toMatchObject({ outcome: 'SANDBOX_DENIED', tool: 'write_file' });
    });

    it('read-only refuses writes anywhere but still reads inside the workspace', () => {
        const { service } = serviceFor('read-only');
        expect(ask(service, join(workspace, 'a.txt'), 'write')).toMatchObject({ ok: false, code: 'SANDBOX_DENIED' });
        expect(ask(service, join(workspace, 'a.txt'), 'read')).toEqual({ ok: true });
    });

    it('danger-full-access allows any path', () => {
        const { service } = serviceFor('full');
        expect(ask(service, join(outside, 'secret.txt'), 'write')).toEqual({ ok: true });
    });

    it('extra roots (the memory directory) and policy roots are allowed', () => {
        const { service } = serviceFor('ask', { roots: [outside] });
        expect(ask(service, join(outside, 'secret.txt'), 'read')).toEqual({ ok: true });
        const { service: plain } = serviceFor('ask');
        expect(ask(plain, join(outside, 'secret.txt'), 'read')).toMatchObject({ ok: false });
        expect(ask(plain, join(outside, 'secret.txt'), 'read', [outside])).toEqual({ ok: true });
    });

    it('a link inside the workspace pointing outside does not open the outside', () => {
        if (!link(outside, join(workspace, 'escape'))) return; // OS without link privileges
        const { service } = serviceFor('ask');
        expect(realPathOf(join(workspace, 'escape', 'secret.txt'))).toBe(join(outside, 'secret.txt'));
        expect(ask(service, join(workspace, 'escape', 'secret.txt'), 'read')).toMatchObject({ ok: false, code: 'SANDBOX_DENIED' });
        // also for a file that does not exist yet behind the link
        expect(ask(service, join(workspace, 'escape', 'new.txt'), 'write')).toMatchObject({ ok: false, code: 'SANDBOX_DENIED' });
    });

    it('a link to somewhere still inside the workspace is fine', () => {
        mkdirSync(join(workspace, 'real'));
        if (!link(join(workspace, 'real'), join(workspace, 'alias'))) return;
        const { service } = serviceFor('ask');
        expect(ask(service, join(workspace, 'alias', 'a.txt'), 'write')).toEqual({ ok: true });
    });

    it('a workspace that is itself reached through a link still contains its own files', () => {
        if (!link(workspace, join(root, 'ws-alias'))) return;
        const { service } = serviceFor('ask');
        expect(service.authorizePath!(caller, { tool: 'write_file', path: join(root, 'ws-alias', 'a.txt'), access: 'write', workspace: join(root, 'ws-alias') })).toEqual({ ok: true });
    });

    it('a dangling link is followed to where it would land', () => {
        if (!link(join(outside, 'not-yet'), join(workspace, 'dangling'))) return;
        const { service } = serviceFor('ask');
        expect(ask(service, join(workspace, 'dangling'), 'write')).toMatchObject({ ok: false, code: 'SANDBOX_DENIED' });
    });

    it('a path that cannot be resolved is refused rather than allowed', () => {
        const { service } = serviceFor('ask');
        // a link loop cannot be resolved
        const a = join(workspace, 'a'); const b = join(workspace, 'b');
        try { symlinkSync(b, a, 'junction'); symlinkSync(a, b, 'junction'); } catch { return; }
        expect(ask(service, join(a, 'x'), 'read')).toMatchObject({ ok: false, code: 'SANDBOX_DENIED' });
    });

    it('records allowed writes (not reads) so the audit shows what was written', () => {
        const { service, decisions } = serviceFor('ask');
        ask(service, join(workspace, 'a.txt'), 'read');
        expect(decisions).toHaveLength(0);
        ask(service, join(workspace, 'a.txt'), 'write');
        expect(decisions).toHaveLength(1);
        expect(decisions[0]).toMatchObject({ outcome: 'allowed', tool: 'write_file' });
    });

    it('isInsideDir is separator-agnostic and does not match a sibling that shares a prefix', () => {
        expect(isInsideDir(workspace, join(workspace, 'x'))).toBe(true);
        expect(isInsideDir(workspace, workspace + '-sibling')).toBe(false);
    });
});
