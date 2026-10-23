import { createEngineControl, EngineControlError } from '../EngineControl';
import type { PolicyControl, PolicyReview } from '../EngineControl';
import { createJobRegistry } from '../../jobs/JobRegistry';
import type { SandboxDecision, SandboxRunner } from '../../sandbox/types';

/** A policy that is just a number: bigger is wider. Enough to exercise the flow without the sandbox package. */
function fakePolicy(initial = 2, ceiling = 3) {
    let level = initial;
    let version = 1;
    const port: PolicyControl = {
        read: () => ({ version, policy: { level } }),
        review(candidate): PolicyReview {
            const next = (candidate as { level?: unknown })?.level;
            if (typeof next !== 'number') return { kind: 'invalid', message: 'level must be a number' };
            if (next > ceiling) return { kind: 'beyond-ceiling', message: `level ${next} exceeds ceiling ${ceiling}`, details: { ceiling } };
            return next <= level ? { kind: 'narrower', next } : { kind: 'wider', next, details: { from: level, to: next } };
        },
        apply(next) { level = next as number; return ++version; },
    };
    return port;
}

const ctx = { tenantId: 'acme', traceId: 'trace-1' };
const setTo = (control: ReturnType<typeof createEngineControl>, level: unknown, extra: Record<string, unknown> = {}) =>
    control.control('set_sandbox_policy', { policy: { level }, ...extra }, ctx);

async function failure(p: Promise<unknown>): Promise<EngineControlError> {
    try { await p; } catch (e) { return e as EngineControlError; }
    throw new Error('expected a rejection');
}

describe('createEngineControl', () => {
    describe('actions', () => {
        it('only offers what it was given', () => {
            expect(createEngineControl({}).actions).toEqual([]);
            expect(createEngineControl({}, { policy: fakePolicy() }).actions).toEqual(['get_sandbox_policy', 'set_sandbox_policy']);
            expect(createEngineControl({}, { jobs: createJobRegistry() }).actions).toEqual(['list_jobs', 'cancel_job']);
        });

        it('an action it does not offer is CONTROL_UNSUPPORTED', async () => {
            const err = await failure(createEngineControl({}).control('set_sandbox_policy', {}, ctx));
            expect(err.code).toBe('CONTROL_UNSUPPORTED');
            expect(err.name).toBe('ControlError');
        });
    });

    describe('set_sandbox_policy', () => {
        it('narrowing is applied without asking and reports the new version', async () => {
            const approve = jest.fn(() => true);
            const control = createEngineControl({}, { policy: fakePolicy(2), approveWidening: approve });
            const out = await setTo(control, 1) as { version: number; policy: unknown };
            expect(out).toEqual({ version: 2, policy: { level: 1 } });
            expect(approve).not.toHaveBeenCalled();
        });

        it('widening without an approver fails closed and changes nothing', async () => {
            const port = fakePolicy(1);
            const control = createEngineControl({}, { policy: port });
            const err = await failure(setTo(control, 2));
            expect(err.code).toBe('APPROVAL_REQUIRED');
            expect(port.read()).toEqual({ version: 1, policy: { level: 1 } });
        });

        it('widening applies only when the approver says yes, and the approver sees what is at stake', async () => {
            const approve = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
            const control = createEngineControl({}, { policy: fakePolicy(1), approveWidening: approve });

            expect((await failure(setTo(control, 2, { by: 'hermes' }))).code).toBe('APPROVAL_REQUIRED');
            const out = await setTo(control, 2, { by: 'hermes' }) as { version: number };
            expect(out.version).toBe(2);
            expect(approve).toHaveBeenLastCalledWith(expect.objectContaining({
                from: { level: 1 }, to: 2, by: 'hermes', details: { from: 1, to: 2 }, context: ctx,
            }));
        });

        it('beyond the ceiling is refused even when the approver would say yes', async () => {
            const approve = jest.fn(() => true);
            const control = createEngineControl({}, { policy: fakePolicy(1, 2), approveWidening: approve });
            const err = await failure(setTo(control, 3));
            expect(err.code).toBe('POLICY_WIDER_THAN_PARENT');
            expect(err.details).toEqual({ ceiling: 2 });
            expect(approve).not.toHaveBeenCalled();
        });

        it('an invalid policy is INVALID_INPUT and a missing one too', async () => {
            const control = createEngineControl({}, { policy: fakePolicy() });
            expect((await failure(setTo(control, 'wide'))).code).toBe('INVALID_INPUT');
            expect((await failure(control.control('set_sandbox_policy', {}, ctx))).code).toBe('INVALID_INPUT');
        });

        it('expectedVersion guards against a stale copy', async () => {
            const control = createEngineControl({}, { policy: fakePolicy(2) });
            await setTo(control, 1);
            const err = await failure(setTo(control, 0, { expectedVersion: 1 }));
            expect(err.code).toBe('INVALID_INPUT');
            expect(err.details).toEqual({ version: 2 });
            await expect(setTo(control, 0, { expectedVersion: 2 })).resolves.toMatchObject({ version: 3 });
        });

        it('concurrent changes are applied one at a time', async () => {
            const port = fakePolicy(3, 3);
            const slow = jest.fn(async () => { await new Promise(r => setTimeout(r, 20)); return true; });
            const control = createEngineControl({}, { policy: port, approveWidening: slow });
            await setTo(control, 1);
            // the first request widens (slow approval), the second narrows: the second must see the first's result
            const [a, b] = await Promise.allSettled([setTo(control, 2), setTo(control, 0)]);
            expect(a.status).toBe('fulfilled');
            expect(b.status).toBe('fulfilled');
            expect(port.read().policy).toEqual({ level: 0 });
            expect(port.read().version).toBe(4);
        });
    });

    describe('get_sandbox_policy', () => {
        it('shows the policy and its version', async () => {
            const control = createEngineControl({}, { policy: fakePolicy(2) });
            expect(await control.control('get_sandbox_policy', {}, ctx)).toEqual({ version: 1, policy: { level: 2 } });
        });
    });

    describe('jobs', () => {
        it('lists every owner (or one) and cancels a job by id', async () => {
            const jobs = createJobRegistry({ cancelGraceMs: 50 });
            const wait = (signal: AbortSignal) => new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new Error('stopped'))));
            const a = jobs.start({ kind: 'bash', owner: 'agent-a', run: wait });
            jobs.start({ kind: 'bash', owner: 'agent-b', run: wait });
            const control = createEngineControl({}, { jobs });

            const all = await control.control('list_jobs', {}, ctx) as { jobs: Array<{ owner: string }> };
            expect(all.jobs.map(j => j.owner).sort()).toEqual(['agent-a', 'agent-b']);
            const mine = await control.control('list_jobs', { owner: 'agent-b' }, ctx) as { jobs: unknown[] };
            expect(mine.jobs).toHaveLength(1);

            expect(await control.control('cancel_job', { id: a.id, by: 'hermes' }, ctx)).toEqual({ id: a.id, cancelled: true });
            expect(jobs.get(a.id, 'agent-a')?.status).toBe('cancelled');
            expect(jobs.list('agent-b')[0].status).toBe('running');
            await jobs.cancelAll();
        });

        it('an unknown job is TASK_NOT_FOUND, a missing id INVALID_INPUT', async () => {
            const control = createEngineControl({}, { jobs: createJobRegistry() });
            expect((await failure(control.control('cancel_job', { id: 'nope' }, ctx))).code).toBe('TASK_NOT_FOUND');
            expect((await failure(control.control('cancel_job', {}, ctx))).code).toBe('INVALID_INPUT');
        });
    });

    describe('audit', () => {
        it('records who asked, the outcome and the version in force, and the engine sandbox decisions beside them', async () => {
            let listener: ((d: SandboxDecision) => void) | undefined;
            const sandbox = { run: jest.fn(), onDecision: (l: (d: SandboxDecision) => void) => { listener = l; return () => { listener = undefined; }; } } as unknown as SandboxRunner;
            const persisted: unknown[] = [];
            const control = createEngineControl({ sandbox }, { policy: fakePolicy(1, 2), onAudit: e => persisted.push(e) });

            await setTo(control, 0, { by: 'hermes' });
            await failure(setTo(control, 2, { by: 'hermes' }));
            await failure(setTo(control, 3, { by: 'hermes' }));
            listener!({ at: Date.now(), agentId: 'coder', sessionId: 's', tool: 'write_file', mode: 'read-only', network: 'none', outcome: 'SANDBOX_DENIED', reason: 'read-only' });

            const trail = await control.audit({});
            expect(trail.map(e => [e.kind, e.outcome])).toEqual([
                ['control', 'applied'], ['control', 'refused'], ['control', 'refused'], ['sandbox', 'SANDBOX_DENIED'],
            ]);
            expect(trail[0]).toMatchObject({ tool: 'set_sandbox_policy', by: 'hermes', version: 2, traceId: 'trace-1' });
            expect(trail[3]).toMatchObject({ agentId: 'coder', tool: 'write_file', detail: 'read-only' });
            expect(persisted).toHaveLength(4);
        });

        it('filters by since and limit, keeps a bounded trail, and dispose stops listening', async () => {
            let listener: ((d: SandboxDecision) => void) | undefined;
            const sandbox = { run: jest.fn(), onDecision: (l: (d: SandboxDecision) => void) => { listener = l; return () => { listener = undefined; }; } } as unknown as SandboxRunner;
            const control = createEngineControl({ sandbox }, { auditCapacity: 3 });
            const decide = (tool: string) => listener!({ at: 0, agentId: 'a', sessionId: 's', tool, mode: 'read-only', network: 'none', outcome: 'allowed' });
            ['t1', 't2', 't3', 't4'].forEach(decide);

            expect((await control.audit({})).map(e => e.tool)).toEqual(['t2', 't3', 't4']);
            expect((await control.audit({ limit: 2 })).map(e => e.tool)).toEqual(['t3', 't4']);
            expect(await control.audit({ since: new Date(Date.now() + 60_000).toISOString() })).toEqual([]);

            control.dispose();
            expect(listener).toBeUndefined();
        });

        it('a failing onAudit never breaks control', async () => {
            const control = createEngineControl({}, { policy: fakePolicy(2), onAudit: () => { throw new Error('disk full'); } });
            await expect(setTo(control, 1)).resolves.toMatchObject({ version: 2 });
        });
    });
});
