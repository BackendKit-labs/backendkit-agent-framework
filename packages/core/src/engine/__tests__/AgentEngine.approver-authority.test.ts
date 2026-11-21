/**
 * What the engine checks about WHO approves when the policy does NOT ask for a role (SPEC-0041 F0). These tests fix the
 * behavior as it is, including the gaps that remain by design or until a later phase: the free-text `approver` is a hint and
 * nothing enforces it (F1 added `approverRoles`, which is checked: see AgentEngine.approver-roles.test.ts), and a person can
 * approve what they themselves asked for (F2 adds `forbidSelfApproval`; the tests marked GAP change on purpose then).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBaseEngine } from '../createBaseEngine';
import { FileApprovalStore } from '../../governance/approval-store';
import { MemoryAuditSink } from '../../governance/audit';
import type { ApprovalOutcome, ApprovalRequest, Approver, ToolPolicy } from '../../governance/types';
import type { AgentProfile, ToolDefinition } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent, type Turn } from '../../__tests__/helpers';

const main: AgentProfile = { ...testAgent, id: 'main', allowedTools: ['pay'], delegatesTo: [] };

/** Payments above 10k go to a person, and say that "finance" is who should approve (free text: the engine does not read it). */
const payments: ToolPolicy = {
    decide: (_principal, call) => (Number(call.args.amount) > 10_000
        ? { effect: 'ask', reason: 'payment above 10k', approver: 'finance', accepts: ['human'] }
        : { effect: 'allow' }),
};

const pay = (amount: number): Turn => ({ tool_calls: [{ id: 'c1', name: 'pay', args: { amount } }] });
const answer = (id: string): ApprovalOutcome => ({ decision: 'approve', by: { kind: 'human', id }, at: new Date().toISOString() });

function build(script: Turn[], extra: { approver?: Approver; approvals?: FileApprovalStore; userId?: string } = {}) {
    const paid: number[] = [];
    const audit = new MemoryAuditSink();
    const tools: ToolDefinition[] = [
        { name: 'pay', description: '', parameters: { type: 'object' }, execute: async (a) => { paid.push(Number((a as { amount: number }).amount)); return 'paid'; } },
    ];
    const { transport } = createMockTransport();
    const engine = createBaseEngine({
        providers: { mock: createScriptedProvider(script) }, defaultProvider: 'mock', agents: [main], defaultAgent: 'main',
        tools, transport, workingDir: process.cwd(), iterationMode: 'auto', audit, policy: payments,
        ...(extra.approver ? { approver: extra.approver } : {}),
        ...(extra.approvals ? { approvals: extra.approvals } : {}),
        ...(extra.userId ? { identity: { userId: extra.userId, tenantId: 'acme', roles: ['employee'] } } : {}),
    });
    return { engine, paid, audit };
}

/** An approver that records the request it was asked, and answers as the person it is given. */
const approverAs = (id: string, seen: ApprovalRequest[] = []): Approver => ({
    ref: { kind: 'human', id },
    request: async (req) => { seen.push(req); return answer(id); },
});

describe('who can approve, as it is today (SPEC-0041 F0)', () => {
    it('the approver is asked, and the request carries who it is for and the free-text hint, which nothing enforces', async () => {
        const seen: ApprovalRequest[] = [];
        const { engine, paid } = build([pay(15_000), { content: 'done' }], { approver: approverAs('ana', seen), userId: 'carlos' });
        await engine.run('pay the invoice');
        expect(paid).toEqual([15_000]);
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({ approver: 'finance', accepts: ['human'], principal: { userId: 'carlos', roles: ['employee'] } });
    });

    it('GAP: the hint "finance" is not checked, so any person approves it, an intern included', async () => {
        const { engine, paid, audit } = build([pay(15_000), { content: 'done' }], { approver: approverAs('intern-17'), userId: 'carlos' });
        await engine.run('pay the invoice');
        expect(paid).toEqual([15_000]);
        expect(audit.events[0]).toMatchObject({ tool: 'pay', decision: 'allow', approval: { by: { kind: 'human', id: 'intern-17' } } });
    });

    it('GAP: the person who asked for the payment can approve it themselves', async () => {
        const { engine, paid } = build([pay(15_000), { content: 'done' }], { approver: approverAs('carlos'), userId: 'carlos' });
        await engine.run('pay the invoice');
        expect(paid).toEqual([15_000]);
    });

    it('the kind of approver is checked: a service cannot satisfy accepts: ["human"]', async () => {
        const service: Approver = { ref: { kind: 'service', id: 'auto-approve' }, request: async () => ({ decision: 'approve', by: { kind: 'service', id: 'auto-approve' }, at: new Date().toISOString() }) };
        const { engine, paid } = build([pay(15_000), { content: 'done' }], { approver: service });
        await engine.run('pay the invoice');
        expect(paid).toEqual([]);
    });

    it('a call below the threshold needs no approval at all', async () => {
        const seen: ApprovalRequest[] = [];
        const { engine, paid } = build([pay(500), { content: 'done' }], { approver: approverAs('ana', seen) });
        await engine.run('pay the invoice');
        expect(paid).toEqual([500]);
        expect(seen).toEqual([]);
    });

    describe('durable approvals: whoever resolves the request is recorded as it was said', () => {
        let dir: string;
        beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'approver-authority-')); });
        afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

        it('GAP: resolve and runApproved take the id as given: the store does not know whether the person exists or may approve', async () => {
            const store = new FileApprovalStore(dir);
            const { engine, paid, audit } = build([pay(15_000), { content: 'pending' }], { approvals: store, userId: 'carlos' });
            await engine.run('pay the invoice');
            const [pending] = await store.list({ status: 'pending' });
            expect(pending).toMatchObject({ approver: 'finance', principal: { userId: 'carlos' } });

            await store.resolve(pending.id, answer('carlos'));        // the same person that asked, with no role of finance
            await expect(engine.runApproved(pending.id)).resolves.toBe('paid');
            expect(paid).toEqual([15_000]);
            // The first event is the ask that was stored; the one that ran carries who approved it.
            expect(audit.events.find(e => e.approval)).toMatchObject({ tool: 'pay', approval: { id: pending.id, by: { kind: 'human', id: 'carlos' } } });
        });

        it('the kind is still checked on the stored approval: an agent cannot approve a human-only request', async () => {
            const store = new FileApprovalStore(dir);
            const { engine, paid } = build([pay(15_000), { content: 'pending' }], { approvals: store });
            await engine.run('pay the invoice');
            const [pending] = await store.list({ status: 'pending' });
            await store.resolve(pending.id, { decision: 'approve', by: { kind: 'agent', id: 'supervisor' }, at: new Date().toISOString() });
            await engine.runApproved(pending.id);
            expect(paid).toEqual([]);
        });
    });
});
