/** ADR-0010: an approval that could not be obtained is a rejection. Findings of the external audit of 2026-11-26. */
import { approverFromCallback } from '../approval';
import { mandateCovers, type Mandate } from '../mandate';
import { ApprovalGate } from '../../engine/ApprovalGate';
import { decideStepApproval } from '../../flow/approval';
import { FlowDefinitionSchema } from '../../flow/types';
import type { ApprovalRequest, Principal, ToolPolicy } from '../types';
import type { ToolApprovalDecision } from '../../types';

const request: ApprovalRequest = {
    id: 'r1', reason: 'x', createdAt: new Date().toISOString(),
    principal: { agentId: 'coder', sessionId: 's', chain: [] },
    subject: { kind: 'tool_call', call: { tool: { name: 'write_file', description: '', parameters: {}, execute: async () => '' }, args: { path: '/x' } } },
} as never;

describe('approverFromCallback (B-02): only an explicit answer approves', () => {
    it.each([undefined, null, 'yes', 'APPROVE', 42])('%j rejects, and says no decision was given', async (answer) => {
        const a = approverFromCallback((async () => answer) as never);
        const out = await a.request(request);
        expect(out.decision).toBe('reject');
        expect(out.reason).toMatch(/no decision/);
    });

    it("'approve' and 'approve_all' approve; 'reject' rejects without a made-up reason", async () => {
        expect((await approverFromCallback(async () => 'approve').request(request)).decision).toBe('approve');
        expect((await approverFromCallback(async () => 'approve_all').request(request)).decision).toBe('approve');
        const r = await approverFromCallback(async () => 'reject').request(request);
        expect(r).toMatchObject({ decision: 'reject' });
        expect(r.reason).toBeUndefined();
    });
});

describe('ApprovalGate, the legacy path (B-02, B-14)', () => {
    const transport = { emit: jest.fn() };
    const gateWith = (answer: unknown) => new ApprovalGate({ onToolApproval: (async () => answer) as () => Promise<ToolApprovalDecision>, transport: transport as never });

    it('an answer that is not approve or approve_all rejects', async () => {
        expect(await gateWith(undefined).check({ name: 'w', args: '{}' }, 'a', undefined, { readOnly: false })).toBe('rejected');
        expect(await gateWith('approve').check({ name: 'w', args: '{}' }, 'a', undefined, { readOnly: false })).toBe('run');
    });

    it('an alwaysAsk that throws asks, it does not skip the question', async () => {
        const onToolApproval = jest.fn(async () => 'reject' as const);
        const g = new ApprovalGate({ onToolApproval, transport: transport as never });
        const tool = { readOnly: true as const, alwaysAsk: () => { throw new Error('bug in the check'); } };
        expect(await g.check({ name: 'install', args: '{"command":"install x"}' }, 'a', undefined, tool)).toBe('rejected');
        expect(onToolApproval).toHaveBeenCalledTimes(1);
    });

    it('arguments that cannot be read ask too', async () => {
        const onToolApproval = jest.fn(async () => 'approve' as const);
        const g = new ApprovalGate({ onToolApproval, transport: transport as never });
        await g.check({ name: 'install', args: '{not json' }, 'a', undefined, { readOnly: true, alwaysAsk: () => false });
        expect(onToolApproval).toHaveBeenCalledTimes(1);
    });
});

describe('decideStepApproval (B-04): who may approve only narrows', () => {
    const def = FlowDefinitionSchema.parse({ flow: 'f', trigger: { type: 'manual' }, steps: [{ id: 'pay', agent: 'ap', prompt: 'pay', gate: { approval: 'human' } }] });
    const step = def.steps[0]!;
    const store = () => {
        const put = jest.fn(async (_r: ApprovalRequest) => undefined);
        return { put, get: jest.fn(async () => undefined), resolve: jest.fn(), markExecuted: jest.fn(), list: jest.fn() };
    };
    const asking = (accepts: Array<'human' | 'agent' | 'service'>): ToolPolicy => ({ decide: async () => ({ effect: 'ask', reason: 'policy', accepts }) });

    it('a policy accepting a person or an agent leaves a step that needs a person needing one', async () => {
        const s = store();
        await decideStepApproval({ store: s as never, policy: asking(['human', 'agent']) }, 'f', 'run1', step, {});
        expect(s.put.mock.calls[0]![0].accepts).toEqual(['human']);
    });

    it('a policy accepting no person for a step that needs one leaves no one: denied', async () => {
        const s = store();
        const r = await decideStepApproval({ store: s as never, policy: asking(['agent']) }, 'f', 'run1', step, {});
        expect(r).toMatchObject({ kind: 'denied' });
        expect(s.put).not.toHaveBeenCalled();
    });
});

describe('mandateCovers (B-06): lists are lists', () => {
    const principal: Principal = { agentId: 'a', sessionId: 's', chain: [] };
    const call = { tool: { name: 'delete', description: '', parameters: {}, execute: async () => '' }, args: {} };
    const m = (extra: Partial<Mandate> | Record<string, unknown>) => ({ id: 'm', issuer: 'i', subject: 'u', actions: ['delete'], ...extra }) as Mandate;

    it('actions given as a text do not match by substring', () => {
        expect(mandateCovers(m({ actions: 'delete_all_records' }), principal, call, { requireSubject: false })).toMatchObject({ ok: false, reason: expect.stringMatching(/list of names/) });
        expect(mandateCovers(m({ actions: ['delete', 7] }), principal, call, { requireSubject: false })).toMatchObject({ ok: false });
    });

    it('resources given as a text do not match by substring', () => {
        const r = mandateCovers(m({ resources: 'invoice-1-and-more' }), principal, call, { requireSubject: false, resourceOf: () => 'invoice-1' });
        expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/list of names/) });
    });

    it('a well formed mandate still covers', () => {
        expect(mandateCovers(m({}), principal, call, { requireSubject: false })).toEqual({ ok: true });
    });
});
