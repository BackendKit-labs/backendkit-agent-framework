import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { runFlow } from '../run';
import type { StepExecutor } from '../run';
import { MemoryRunJournal } from '../journal';
import { stepApprovalId } from '../approval';
import { FlowDefinitionSchema } from '../types';
import { FileApprovalStore, MemoryApprovalStore } from '../../governance/approval-store';
import type { Approver, ToolPolicy } from '../../governance/types';

const def = FlowDefinitionSchema.parse({
    flow: 'f', trigger: { type: 'manual' },
    steps: [
        { id: 'a', agent: 'x', prompt: 'a' },
        { id: 'pay', agent: 'x', prompt: 'pay', after: ['a'], gate: { approval: 'human' } },
        { id: 'c', agent: 'x', prompt: 'c', after: ['pay'] },
    ],
});

function counting() {
    const ran: string[] = [];
    const executor: StepExecutor = { run: async (s) => { ran.push(s.id); return { content: `out-${s.id}` }; } };
    return { executor, ran };
}

const human = { kind: 'human' as const, id: 'ana' };

describe('flow step approval through the ApprovalStore', () => {
    it('stops with awaiting_approval, then continues after the approval is resolved', async () => {
        const store = new MemoryApprovalStore();
        const journal = new MemoryRunJournal();
        const { executor, ran } = counting();
        const approvals = { store, identity: { userId: 'u1' } };

        const first = await runFlow(def, { executor, journal, runId: 'r1', approvals });
        expect(first.status).toBe('awaiting_approval');
        expect(ran).toEqual(['a']);
        expect(first.steps.c).toBeUndefined();
        const run = (await journal.get('r1'))!;
        expect(run.status).toBe('awaiting_approval');
        expect(run.waiting).toEqual({ stepId: 'pay', approvalId: stepApprovalId('r1', 'pay') });
        expect(run.steps.pay.status).toBe('awaiting_approval');

        const pending = await store.list({ status: 'pending' });
        expect(pending).toHaveLength(1);
        expect(pending[0].subject).toMatchObject({ kind: 'workflow_step', workflow: 'f', step: 'pay' });
        expect(pending[0].accepts).toEqual(['human']);

        await store.resolve(stepApprovalId('r1', 'pay'), { decision: 'approve', by: human, at: new Date().toISOString() });
        const second = await runFlow(def, { executor, journal, runId: 'r1', approvals });
        expect(second.status).toBe('completed');
        expect(ran).toEqual(['a', 'pay', 'c']); // a was not repeated
        expect((await journal.get('r1'))!.waiting).toBeUndefined();
    });

    it('a rejection rejects the step and skips what depends on it', async () => {
        const store = new MemoryApprovalStore();
        const { executor, ran } = counting();
        const approver: Approver = { request: async () => ({ decision: 'reject', by: human, reason: 'no budget', at: new Date().toISOString() }) };
        const r = await runFlow(def, { executor, approvals: { store, approver } });
        expect(r.status).toBe('rejected');
        expect(r.steps.pay.status).toBe('rejected');
        expect(r.steps.c.status).toBe('skipped');
        expect(ran).toEqual(['a']);
    });

    it('an in-process approver answers inline', async () => {
        const store = new MemoryApprovalStore();
        const { executor, ran } = counting();
        const approver: Approver = { request: async () => ({ decision: 'approve', by: human, at: new Date().toISOString() }) };
        const r = await runFlow(def, { executor, approvals: { store, approver } });
        expect(r.status).toBe('completed');
        expect(ran).toEqual(['a', 'pay', 'c']);
    });

    it('an agent approver from the delegation chain is not accepted (counts as rejection)', async () => {
        const store = new MemoryApprovalStore();
        const { executor } = counting();
        const approver: Approver = { request: async () => ({ decision: 'approve', by: { kind: 'agent', id: 'x' }, at: new Date().toISOString() }) };
        const r = await runFlow(def, { executor, approvals: { store, approver } });
        expect(r.steps.pay.status).toBe('rejected'); // the step needs a human
    });

    it('a learned "ask" rule for flow.step:<id> stops a step that has no gate', async () => {
        const store = new MemoryApprovalStore();
        const journal = new MemoryRunJournal();
        const { executor, ran } = counting();
        const policy: ToolPolicy = {
            decide: (_p, call) => call.tool.name === 'flow.step:a'
                ? { effect: 'ask', reason: 'learned: a failed before' }
                : { effect: 'allow' },
        };
        const plain = FlowDefinitionSchema.parse({
            flow: 'g', trigger: { type: 'manual' },
            steps: [{ id: 'a', agent: 'x', prompt: 'a' }, { id: 'b', agent: 'x', prompt: 'b', after: ['a'] }],
        });
        const first = await runFlow(plain, { executor, journal, runId: 'r2', approvals: { store, policy } });
        expect(first.status).toBe('awaiting_approval');
        expect(ran).toEqual([]);
        expect((await store.list({ status: 'pending' }))[0].reason).toBe('learned: a failed before');

        await store.resolve(stepApprovalId('r2', 'a'), { decision: 'approve', by: human, at: new Date().toISOString() });
        const second = await runFlow(plain, { executor, journal, runId: 'r2', approvals: { store, policy } });
        expect(second.status).toBe('completed');
        expect(ran).toEqual(['a', 'b']);
    });

    it('a policy "deny" fails the step without asking', async () => {
        const store = new MemoryApprovalStore();
        const { executor, ran } = counting();
        const policy: ToolPolicy = { decide: (_p, call) => (call.tool.name === 'flow.step:a' ? { effect: 'deny', reason: 'blocked' } : { effect: 'allow' }) };
        const r = await runFlow(def, { executor, approvals: { store, policy } });
        expect(r.status).toBe('failed');
        expect(r.steps.a).toMatchObject({ status: 'failed', error: 'blocked' });
        expect(ran).toEqual([]);
        expect(await store.list()).toEqual([]);
    });

    it('a suspended run does not run compensations or report its dependents as failed', async () => {
        const store = new MemoryApprovalStore();
        const { executor } = counting();
        const withComp = FlowDefinitionSchema.parse({
            ...def, compensation: [{ on: 'a.failed', agent: 'undo', prompt: 'u' }],
        });
        const r = await runFlow(withComp, { executor, approvals: { store } });
        expect(r.status).toBe('awaiting_approval');
        expect(r.compensations).toEqual([]);
        expect(Object.keys(r.steps)).toEqual(['a']);
    });

    it('survives a restart: the request is durable in a FileApprovalStore', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-appr-'));
        try {
            const journal = new MemoryRunJournal();
            const { executor, ran } = counting();
            await runFlow(def, { executor, journal, runId: 'r3', approvals: { store: new FileApprovalStore(dir) } });
            const other = new FileApprovalStore(dir); // "another process"
            expect(await other.list({ status: 'pending' })).toHaveLength(1);
            await other.resolve(stepApprovalId('r3', 'pay'), { decision: 'approve', by: human, at: new Date().toISOString() });
            const r = await runFlow(def, { executor, journal, runId: 'r3', approvals: { store: other } });
            expect(r.status).toBe('completed');
            expect(ran).toEqual(['a', 'pay', 'c']);
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});
