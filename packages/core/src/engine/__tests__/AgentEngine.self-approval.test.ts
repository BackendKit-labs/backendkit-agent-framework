/** Four eyes: with `forbidSelfApproval`, whoever an agent acts for does not approve what it asked for (SPEC-0041 F2). */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBaseEngine, type BaseEngineOptions } from '../createBaseEngine';
import { FileApprovalStore } from '../../governance/approval-store';
import { MemoryAuditSink } from '../../governance/audit';
import { approvalProblem } from '../../governance/approval';
import type { ApprovalOutcome, Approver, ApproverDirectory, ApproverRef, Identity, ToolPolicy } from '../../governance/types';
import type { AgentProfile, ToolDefinition } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent, type Turn } from '../../__tests__/helpers';

const main: AgentProfile = { ...testAgent, id: 'main', allowedTools: ['pay'], delegatesTo: [] };

const payments: ToolPolicy = {
    decide: (_principal, call) => (Number(call.args.amount) > 10_000
        ? { effect: 'ask', reason: 'payment above 10k', accepts: ['human'], approverRoles: ['finance'] }
        : { effect: 'allow' }),
};

/** `carlos` asks for the payment and is in finance himself: the case four eyes is for. */
const directory: ApproverDirectory = {
    describe: (by: ApproverRef) => ({ carlos: { roles: ['finance'] }, ana: { roles: ['finance'] } } as Record<string, { roles: string[] }>)[by.id],
};

const pay = (amount: number): Turn => ({ tool_calls: [{ id: 'c1', name: 'pay', args: { amount } }] });
const answer = (id: string): ApprovalOutcome => ({ decision: 'approve', by: { kind: 'human', id }, at: new Date().toISOString() });
const approverAs = (id: string): Approver => ({ ref: { kind: 'human', id }, request: async () => answer(id) });

function build(script: Turn[], extra: Partial<BaseEngineOptions> = {}, identity: Identity | null = { userId: 'carlos', tenantId: 'acme' }) {
    const paid: number[] = [];
    const audit = new MemoryAuditSink();
    const tools: ToolDefinition[] = [
        { name: 'pay', description: '', parameters: { type: 'object' }, execute: async (a) => { paid.push(Number((a as { amount: number }).amount)); return 'paid'; } },
    ];
    const { transport } = createMockTransport();
    const engine = createBaseEngine({ requireAgentIdentity: false,
        providers: { mock: createScriptedProvider(script) }, defaultProvider: 'mock', agents: [main], defaultAgent: 'main',
        tools, transport, workingDir: process.cwd(), iterationMode: 'auto', audit, policy: payments, approverDirectory: directory,
        ...(identity ? { identity } : {}), ...extra,
    });
    return { engine, paid, audit };
}

const lastEvent = (audit: MemoryAuditSink) => audit.events[audit.events.length - 1];

describe('forbidSelfApproval', () => {
    it('off by default: the person who asked approves their own request, as before', async () => {
        const { engine, paid } = build([pay(15_000), { content: 'done' }], { approver: approverAs('carlos') });
        await engine.run('pay');
        expect(paid).toEqual([15_000]);
    });

    it('on: the person who asked cannot approve, and the refusal says why', async () => {
        const { engine, paid, audit } = build([pay(15_000), { content: 'done' }], { approver: approverAs('carlos'), forbidSelfApproval: true });
        await engine.run('pay');
        expect(paid).toEqual([]);
        expect(lastEvent(audit)).toMatchObject({ decision: 'deny', reason: expect.stringContaining('asked for this action and cannot approve it') });
    });

    it('on: another person with the role approves, and it runs', async () => {
        const { engine, paid, audit } = build([pay(15_000), { content: 'done' }], { approver: approverAs('ana'), forbidSelfApproval: true });
        await engine.run('pay');
        expect(paid).toEqual([15_000]);
        expect(lastEvent(audit)).toMatchObject({ approval: { by: { id: 'ana' }, authority: { matched: 'finance' } } });
    });

    it('on: holding the role is not enough for the person who asked (roles and four eyes add up)', async () => {
        const { engine, paid } = build([pay(15_000), { content: 'done' }], { approver: approverAs('carlos'), approverDirectory: directory, forbidSelfApproval: true });
        await engine.run('pay');
        expect(paid).toEqual([]);
    });

    it('on, with no userId in the identity: nobody to compare with, so the rule does nothing', async () => {
        const { engine, paid } = build([pay(15_000), { content: 'done' }], { approver: approverAs('carlos'), forbidSelfApproval: true }, null);
        await engine.run('pay');
        expect(paid).toEqual([15_000]);
    });

    it('a call that needs no approval is not touched', async () => {
        const { engine, paid } = build([pay(500), { content: 'done' }], { forbidSelfApproval: true });
        await engine.run('pay');
        expect(paid).toEqual([500]);
    });

    describe('durable approvals: who asked is what the stored request recorded', () => {
        let dir: string;
        beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'self-approval-')); });
        afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

        it('the person who asked resolves it and runApproved refuses it', async () => {
            const store = new FileApprovalStore(dir);
            const { engine, paid, audit } = build([pay(15_000), { content: 'pending' }], { approvals: store, forbidSelfApproval: true });
            await engine.run('pay');
            const [pending] = await store.list({ status: 'pending' });
            expect(pending.principal.userId).toBe('carlos');
            await store.resolve(pending.id, answer('carlos'));
            await engine.runApproved(pending.id);
            expect(paid).toEqual([]);
            expect(lastEvent(audit)).toMatchObject({ decision: 'deny', reason: expect.stringContaining('asked for this action') });
        });

        it('another person resolves it and it runs once', async () => {
            const store = new FileApprovalStore(dir);
            const { engine, paid } = build([pay(15_000), { content: 'pending' }], { approvals: store, forbidSelfApproval: true });
            await engine.run('pay');
            const [pending] = await store.list({ status: 'pending' });
            await store.resolve(pending.id, answer('ana'));
            await expect(engine.runApproved(pending.id)).resolves.toBe('paid');
            expect(paid).toEqual([15_000]);
        });

        it('a worker that runs it with no identity of its own still knows who asked: it comes from the stored request', async () => {
            const store = new FileApprovalStore(dir);
            const first = build([pay(15_000), { content: 'pending' }], { approvals: store, forbidSelfApproval: true });
            await first.engine.run('pay');
            const [pending] = await store.list({ status: 'pending' });
            await store.resolve(pending.id, answer('carlos'));
            const worker = build([], { approvals: store, forbidSelfApproval: true }, null);     // restarted, no per-user identity
            await worker.engine.runApproved(pending.id);
            expect(worker.paid).toEqual([]);
        });
    });
});

describe('approvalProblem with forbidSelfApproval', () => {
    const principal = { agentId: 'main', sessionId: 's', chain: ['u-ana', 'main'], userId: 'ana' };
    const outcome = (by: ApproverRef): ApprovalOutcome => ({ decision: 'approve', by, at: new Date().toISOString() });
    const never = async () => false;

    it('refuses the user an agent acts for, whatever the kind of approver', async () => {
        for (const kind of ['human', 'service'] as const) {
            expect(await approvalProblem(outcome({ kind, id: 'ana' }), { principal, forbidSelfApproval: true }, never)).toMatch(/asked for this action/);
        }
    });

    it('refuses a person who is in the delegation chain', async () => {
        expect(await approvalProblem(outcome({ kind: 'human', id: 'u-ana' }), { principal, forbidSelfApproval: true }, never)).toMatch(/asked for this action/);
    });

    it('lets another person approve', async () => {
        expect(await approvalProblem(outcome({ kind: 'human', id: 'bruno' }), { principal, forbidSelfApproval: true }, never)).toBeUndefined();
    });

    it('does nothing without the option', async () => {
        expect(await approvalProblem(outcome({ kind: 'human', id: 'ana' }), { principal }, never)).toBeUndefined();
    });
});
