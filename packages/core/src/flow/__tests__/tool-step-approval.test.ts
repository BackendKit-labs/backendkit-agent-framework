import { runFlow } from '../run';
import type { StepExecutor, StepInput } from '../run';
import { MemoryRunJournal } from '../journal';
import { stepApprovalId, callDigest } from '../approval';
import { FlowDefinitionSchema } from '../types';
import { MemoryApprovalStore } from '../../governance/approval-store';
import type { ToolPolicy } from '../../governance/types';

/** SPEC-0046: a tool step that needs a person is approved for the call that will run, and for that one only. */

const pay = FlowDefinitionSchema.parse({
    flow: 'f', trigger: { type: 'manual' },
    steps: [{ id: 'pay', agent: 'ledger', kind: 'tool', prompt: 'Pay', gate: { approval: 'human' }, tool: { name: 'ejecutar_pago', args: { importe: '{{payload.amount}}', cuenta: '{{payload.account}}' } } }],
});

function counting() {
    const calls: StepInput['tool'][] = [];
    const executor: StepExecutor = { run: async (_s, i) => { calls.push(i.tool); return { content: '{}' }; } };
    return { executor, calls };
}

describe('approval of a tool step', () => {
    it('shows the approver the call that will run, with the real arguments', async () => {
        const store = new MemoryApprovalStore();
        const { executor, calls } = counting();
        const r = await runFlow(pay, { executor, runId: 'r1', payload: { amount: 1500, account: 'A1' }, approvals: { store } });
        expect(r.status).toBe('awaiting_approval');
        expect(calls).toEqual([]);                                            // nothing ran before the answer
        const [req] = await store.list({ status: 'pending' });
        expect(req!.subject).toMatchObject({ kind: 'workflow_step', tool: { name: 'ejecutar_pago', args: { importe: 1500, cuenta: 'A1' } }, callDigest: callDigest({ name: 'ejecutar_pago', args: { importe: 1500, cuenta: 'A1' } }) });
    });

    it('the arguments shown go through redact, and the digest is of the real call', async () => {
        const store = new MemoryApprovalStore();
        await runFlow(pay, { executor: counting().executor, runId: 'r1', payload: { amount: 1500, account: 'A1' }, approvals: { store }, redact: s => s.replace('A1', '***') });
        const [req] = await store.list({ status: 'pending' });
        expect(req!.subject).toMatchObject({ tool: { args: { cuenta: '***' } }, callDigest: callDigest({ name: 'ejecutar_pago', args: { importe: 1500, cuenta: 'A1' } }) });
    });

    it('runs the call that was approved when it is resumed with the same payload', async () => {
        const store = new MemoryApprovalStore();
        const journal = new MemoryRunJournal();
        const { executor, calls } = counting();
        const payload = { amount: 100, account: 'A1' };
        await runFlow(pay, { executor, journal, runId: 'r1', payload, approvals: { store } });
        await store.resolve(stepApprovalId('r1', 'pay'), { decision: 'approve', by: { kind: 'human', id: 'ana' }, at: new Date().toISOString() });
        const r = await runFlow(pay, { executor, journal, runId: 'r1', payload, approvals: { store } });
        expect(r.status).toBe('completed');
        expect(calls).toEqual([{ name: 'ejecutar_pago', args: { importe: 100, cuenta: 'A1' } }]);
    });

    it('does NOT run a call that is not the one approved: "pay 100" approved, a resume with 900 is refused', async () => {
        const store = new MemoryApprovalStore();
        const journal = new MemoryRunJournal();
        const { executor, calls } = counting();
        await runFlow(pay, { executor, journal, runId: 'r1', payload: { amount: 100, account: 'A1' }, approvals: { store } });
        await store.resolve(stepApprovalId('r1', 'pay'), { decision: 'approve', by: { kind: 'human', id: 'ana' }, at: new Date().toISOString() });
        const r = await runFlow(pay, { executor, journal, runId: 'r1', payload: { amount: 900, account: 'A1' }, approvals: { store } });
        expect(r.status).toBe('failed');
        expect(r.steps.pay.error).toMatch(/not the one that was approved/);
        expect(calls).toEqual([]);
    });

    it('a tool step is never approved after it ran: it fails without running', async () => {
        const { executor, calls } = counting();
        const r = await runFlow(pay, { executor, runId: 'r1', payload: { amount: 1, account: 'A' }, approvals: { store: new MemoryApprovalStore(), when: 'after' } });
        expect(r.status).toBe('failed');
        expect(r.steps.pay.error).toMatch(/needs approvals.when: 'before'/);
        expect(calls).toEqual([]);
    });
});

describe('the policy of a tool step', () => {
    it('sees the arguments of the call, so a limit of amount can measure them', async () => {
        let seen: unknown;
        const policy: ToolPolicy = { decide: async (_p, call) => { seen = call.args; return { effect: 'allow', reason: 'ok' }; } };
        const free = FlowDefinitionSchema.parse({ flow: 'f', trigger: { type: 'manual' }, steps: [{ id: 'pay', agent: 'l', kind: 'tool', prompt: 'p', tool: { name: 't', args: { importe: '{{payload.amount}}' } } }] });
        await runFlow(free, { executor: counting().executor, payload: { amount: 7 }, approvals: { store: new MemoryApprovalStore(), policy } });
        expect(seen).toEqual({ importe: 7 });
    });
});
