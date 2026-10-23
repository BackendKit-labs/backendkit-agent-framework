import { join } from 'path';
import { createEngineControl, type EngineControl } from '@backendkit-labs/agent-core';
import { createSandboxPolicy, createSandboxService, sandboxPolicyControl, NoneBackend } from '../index';
import type { SandboxPolicyConfig } from '../index';

const ctx = { tenantId: 'acme', traceId: 'trace-1' };
const caller = { agentId: 'coder', sessionId: 's1' };
// A read-only child of an auto-edit policy must keep asking for commands (`approval`), or it would be wider in that dimension.
const WRITERS = ['write_file', 'edit_file'];
const LOCKDOWN: SandboxPolicyConfig = { preset: 'read-only', approval: 'commands', writeTools: WRITERS };

function build(initial: SandboxPolicyConfig, opts: { ceiling?: SandboxPolicyConfig; approve?: () => boolean } = {}) {
    const policy = createSandboxPolicy(initial);
    const service = createSandboxService({ policy, backends: [new NoneBackend()] });
    const control = createEngineControl({ sandbox: service }, {
        policy: sandboxPolicyControl(policy, { ceiling: opts.ceiling }),
        ...(opts.approve ? { approveWidening: opts.approve } : {}),
    });
    return { policy, service, control };
}

const set = (control: EngineControl, policy: unknown, extra: Record<string, unknown> = {}) =>
    control.control('set_sandbox_policy', { policy, by: 'hermes', ...extra }, ctx);
const codeOf = async (p: Promise<unknown>) => { try { await p; } catch (e) { return (e as { code: string }).code; } return 'resolved'; };

describe('controlling a sandbox policy from outside', () => {
    it('fixing read-only makes the very next write refused, and the decision is in the audit trail', async () => {
        const { service, control } = build({ preset: 'auto-edit', writeTools: WRITERS });
        const target = { tool: 'write_file', path: join(process.cwd(), 'out.txt'), access: 'write' as const, workspace: process.cwd() };
        expect(service.authorizeTool!(caller, 'write_file')).toEqual({ ok: true });
        expect(service.authorizePath!(caller, target)).toEqual({ ok: true });

        await set(control, LOCKDOWN);

        const verdict = service.authorizeTool!(caller, 'write_file');
        expect(verdict).toMatchObject({ ok: false, code: 'SANDBOX_DENIED' });
        expect(service.authorizePath!(caller, target)).toMatchObject({ ok: false, code: 'SANDBOX_DENIED' });
        const trail = await control.audit({});
        expect(trail.find(e => e.kind === 'control')).toMatchObject({ tool: 'set_sandbox_policy', outcome: 'applied', by: 'hermes', version: 2, traceId: 'trace-1' });
        expect(trail.filter(e => e.kind === 'sandbox').map(e => e.outcome)).toEqual(['allowed', 'SANDBOX_DENIED', 'SANDBOX_DENIED']);
    });

    it('a command the new policy cannot confine is refused (fail closed) and shows up as a sandbox decision beside the policy change', async () => {
        const { service, control } = build({ preset: 'auto-edit', writeTools: WRITERS });
        await set(control, LOCKDOWN);
        const out = await service.run(caller, { tool: 'run_command', command: 'echo hi', cwd: process.cwd() });
        expect(out.ok).toBe(false);
        const trail = await control.audit({});
        expect(trail.map(e => e.kind)).toEqual(['control', 'sandbox']);
        expect(trail[1]).toMatchObject({ agentId: 'coder', tool: 'run_command', outcome: 'SANDBOX_UNAVAILABLE' });
    });

    it('widening is not applied without approval and the policy stays as it was', async () => {
        const { policy, control } = build({ preset: 'read-only' });
        expect(await codeOf(set(control, { preset: 'auto-edit' }))).toBe('APPROVAL_REQUIRED');
        expect(policy.snapshot()).toEqual({ preset: 'read-only' });
        expect(policy.version).toBe(1);
    });

    it('widening with approval applies, and says so in the trail', async () => {
        const { policy, control } = build({ preset: 'read-only' }, { approve: () => true });
        await set(control, { preset: 'auto-edit' });
        expect(policy.snapshot()).toEqual({ preset: 'auto-edit' });
        expect((await control.audit({}))[0]).toMatchObject({ outcome: 'widened', version: 2 });
    });

    it('the operator ceiling is a hard limit: no approval gets past it', async () => {
        const { policy, control } = build({ preset: 'read-only' }, { ceiling: { preset: 'auto-edit' }, approve: () => true });
        await set(control, { preset: 'auto-edit' });
        expect(await codeOf(set(control, { preset: 'full' }))).toBe('POLICY_WIDER_THAN_PARENT');
        expect(policy.snapshot()).toEqual({ preset: 'auto-edit' });
    });

    it('an invalid policy is INVALID_INPUT and leaves the policy alone', async () => {
        const { policy, control } = build({ preset: 'ask' });
        expect(await codeOf(set(control, { mode: 'everything' }))).toBe('INVALID_INPUT');
        expect(await codeOf(set(control, 'read-only'))).toBe('INVALID_INPUT');
        expect(policy.version).toBe(1);
    });

    it('get_sandbox_policy returns what is in force, as data', async () => {
        const { control } = build({ preset: 'ask', roots: ['/data'] });
        expect(await control.control('get_sandbox_policy', {}, ctx)).toEqual({ version: 1, policy: { preset: 'ask', roots: ['/data'] } });
    });

    it('a change keeps the per-agent rules honest: a rule cannot be used to widen under the cover of narrowing', async () => {
        const { control } = build({ preset: 'read-only' }, { approve: () => false });
        const sneaky = { preset: 'read-only', rules: [{ tool: 'run_command', mode: 'danger-full-access' }] };
        expect(await codeOf(set(control, sneaky))).toBe('APPROVAL_REQUIRED');
    });
});
