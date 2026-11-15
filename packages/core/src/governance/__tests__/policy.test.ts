import { agentCouldPerform, combineDecisions, defaultToolPolicy, evaluatePolicies } from '../policy';
import { approvalProblem, approverFromCallback } from '../approval';
import type { ApprovalRequest, Principal, ToolCall } from '../types';
import type { ToolDefinition } from '../../types';

const principal: Principal = { agentId: 'worker', sessionId: 's', chain: ['boss', 'worker'] };
const tool = (facts: Partial<ToolDefinition> = {}): ToolDefinition => ({ name: 't', description: '', parameters: { type: 'object' }, execute: async () => '', ...facts });
const call = (facts: Partial<ToolDefinition> = {}): ToolCall => ({ tool: tool(facts), args: {} });

describe('defaultToolPolicy (SPEC-0014 §4)', () => {
    it('readOnly runs, destructive asks a person, anything else asks', async () => {
        expect(await defaultToolPolicy.decide(principal, call({ readOnly: true }))).toMatchObject({ effect: 'allow' });
        expect(await defaultToolPolicy.decide(principal, call({ destructive: true }))).toMatchObject({ effect: 'ask', accepts: ['human'] });
        const plain = await defaultToolPolicy.decide(principal, call());
        expect(plain).toMatchObject({ effect: 'ask' });
        expect(plain).not.toHaveProperty('accepts');
    });
});

describe('combineDecisions', () => {
    it('deny wins over ask and allow', () => {
        expect(combineDecisions([{ effect: 'allow' }, { effect: 'ask', reason: 'a' }, { effect: 'deny', reason: 'no' }])).toEqual({ effect: 'deny', reason: 'no' });
    });

    it('asks join reasons and intersect accepted kinds (strictest wins)', () => {
        expect(combineDecisions([
            { effect: 'ask', reason: 'r1', accepts: ['human', 'agent'] },
            { effect: 'allow' },
            { effect: 'ask', reason: 'r2', accepts: ['human', 'service'] },
        ])).toEqual({ effect: 'ask', reason: 'r1; r2', accepts: ['human'] });
    });

    it('allow keeps the most restrictive mode', () => {
        expect(combineDecisions([{ effect: 'allow', mode: 'sandboxed' }, { effect: 'allow', mode: 'dry_run' }, { effect: 'allow' }]))
            .toMatchObject({ effect: 'allow', mode: 'dry_run' });
        expect(combineDecisions([])).toEqual({ effect: 'allow' });
    });

    it('a policy that throws denies (fail-closed)', async () => {
        const d = await evaluatePolicies([{ decide: () => { throw new Error('PDP down'); } }, { decide: () => ({ effect: 'allow' }) }], principal, call());
        expect(d).toEqual({ effect: 'deny', reason: 'policy failed: PDP down' });
    });
});

describe('agentCouldPerform (rule 3)', () => {
    it('allow or an ask an agent may satisfy: yes; deny or an ask reserved for people: no', () => {
        expect(agentCouldPerform({ effect: 'allow' })).toBe(true);
        expect(agentCouldPerform({ effect: 'ask', reason: 'r' })).toBe(true);
        expect(agentCouldPerform({ effect: 'ask', reason: 'r', accepts: ['agent', 'human'] })).toBe(true);
        expect(agentCouldPerform({ effect: 'ask', reason: 'r', accepts: ['human'] })).toBe(false);
        expect(agentCouldPerform({ effect: 'deny', reason: 'r' })).toBe(false);
    });
});

describe('approvalProblem (SPEC-0014 §6.2)', () => {
    const req = { principal, accepts: undefined as ApprovalRequest['accepts'] };
    const can = async () => true;
    const at = '2026-11-14T00:00:00.000Z';

    it('rule 1: the approver kind must be accepted', async () => {
        expect(await approvalProblem({ decision: 'approve', by: { kind: 'agent', id: 'qa' }, at }, { principal, accepts: ['human'] }, can))
            .toMatch(/needs approval by human, not by agent "qa"/);
        expect(await approvalProblem({ decision: 'approve', by: { kind: 'human', id: 'ana' }, at }, { principal, accepts: ['human'] }, can))
            .toBeUndefined();
    });

    it('rule 2: no agent of the requesting chain approves', async () => {
        for (const id of ['worker', 'boss']) {
            expect(await approvalProblem({ decision: 'approve', by: { kind: 'agent', id }, at }, req, can)).toMatch(/own delegation chain/);
        }
        expect(await approvalProblem({ decision: 'approve', by: { kind: 'service', id: 'worker' }, at }, req, can)).toMatch(/own delegation chain/);
    });

    it('rule 3: an agent approves only what it could do itself', async () => {
        expect(await approvalProblem({ decision: 'approve', by: { kind: 'agent', id: 'qa' }, at }, req, async () => false))
            .toMatch(/not allowed to perform itself/);
        expect(await approvalProblem({ decision: 'approve', by: { kind: 'agent', id: 'qa' }, at }, req, can)).toBeUndefined();
    });

    it('an approval that does not say who approved is invalid', async () => {
        expect(await approvalProblem({ decision: 'approve', by: { kind: 'robot' as never, id: 'x' }, at }, req, can)).toMatch(/who approved/);
        expect(await approvalProblem({ decision: 'approve', by: { kind: 'human', id: '' }, at }, req, can)).toMatch(/who approved/);
    });
});

describe('approverFromCallback', () => {
    const request = (facts: Partial<ToolDefinition>, accepts?: ApprovalRequest['accepts']): ApprovalRequest => ({
        id: 'r', principal, subject: { kind: 'tool_call', call: { tool: tool(facts), args: { a: 1 } } }, reason: 'x',
        ...(accepts ? { accepts } : {}), createdAt: '2026-11-14T00:00:00.000Z',
    });

    it('answers as a person and maps the legacy decisions', async () => {
        const answers = ['approve', 'reject'] as const;
        let i = 0;
        const approver = approverFromCallback(async () => answers[i++]);
        expect(await approver.request(request({}))).toMatchObject({ decision: 'approve', by: { kind: 'human' } });
        expect(await approver.request(request({}))).toMatchObject({ decision: 'reject' });
    });

    it('approve_all stops asking, except for destructive or human-only requests', async () => {
        const asked: string[] = [];
        const approver = approverFromCallback(async (name) => { asked.push(name); return 'approve_all'; });
        await approver.request(request({ name: 'first' }));
        await approver.request(request({ name: 'second' }));
        await approver.request(request({ name: 'erase', destructive: true }));
        await approver.request(request({ name: 'install' }, ['human']));
        expect(asked).toEqual(['first', 'erase', 'install']);
    });
});
