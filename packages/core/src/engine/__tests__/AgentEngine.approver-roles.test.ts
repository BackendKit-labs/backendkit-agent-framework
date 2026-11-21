/** An `ask` can require a role, and the engine checks it against the application's directory (SPEC-0041 F1). */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBaseEngine } from '../createBaseEngine';
import { FileApprovalStore } from '../../governance/approval-store';
import { MemoryAuditSink } from '../../governance/audit';
import { combineDecisions } from '../../governance/policy';
import { approverAuthority } from '../../governance/approval';
import type { ApprovalOutcome, Approver, ApproverDirectory, ApproverProfile, ApproverRef, ToolPolicy } from '../../governance/types';
import type { AgentProfile, ToolDefinition } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent, type Turn } from '../../__tests__/helpers';

const main: AgentProfile = { ...testAgent, id: 'main', allowedTools: ['pay'], delegatesTo: [] };

const payments: ToolPolicy = {
    decide: (_principal, call) => (Number(call.args.amount) > 10_000
        ? { effect: 'ask', reason: 'payment above 10k', approver: 'finance', accepts: ['human'], approverRoles: ['finance'] }
        : { effect: 'allow' }),
};

/** The application's users. `ana` is in finance, `carlos` asked for the payment, `intern-17` is nobody in particular. */
const users: Record<string, ApproverProfile> = {
    ana: { roles: ['finance', 'employee'], tenantId: 'acme' },
    carlos: { roles: ['employee'], tenantId: 'acme' },
    'intern-17': { roles: ['intern'], tenantId: 'acme' },
    otto: { roles: ['finance'], tenantId: 'globex' },
};
const directory: ApproverDirectory = { describe: (by: ApproverRef) => users[by.id] };

const pay = (amount: number): Turn => ({ tool_calls: [{ id: 'c1', name: 'pay', args: { amount } }] });
const answer = (id: string): ApprovalOutcome => ({ decision: 'approve', by: { kind: 'human', id }, at: new Date().toISOString() });
const approverAs = (id: string): Approver => ({ ref: { kind: 'human', id }, request: async () => answer(id) });

function build(script: Turn[], extra: Partial<Parameters<typeof createBaseEngine>[0]> = {}) {
    const paid: number[] = [];
    const audit = new MemoryAuditSink();
    const tools: ToolDefinition[] = [
        { name: 'pay', description: '', parameters: { type: 'object' }, execute: async (a) => { paid.push(Number((a as { amount: number }).amount)); return 'paid'; } },
    ];
    const { transport } = createMockTransport();
    const engine = createBaseEngine({
        providers: { mock: createScriptedProvider(script) }, defaultProvider: 'mock', agents: [main], defaultAgent: 'main',
        tools, transport, workingDir: process.cwd(), iterationMode: 'auto', audit, policy: payments,
        identity: { userId: 'carlos', tenantId: 'acme', roles: ['employee'] }, ...extra,
    });
    return { engine, paid, audit };
}

const lastEvent = (audit: MemoryAuditSink) => audit.events[audit.events.length - 1];

describe('approverRoles: who may approve is checked, not hinted', () => {
    it('a person with the role approves, and the audit event says which role of the directory covered it', async () => {
        const { engine, paid, audit } = build([pay(15_000), { content: 'done' }], { approver: approverAs('ana'), approverDirectory: directory });
        await engine.run('pay');
        expect(paid).toEqual([15_000]);
        expect(lastEvent(audit)).toMatchObject({
            decision: 'allow',
            approval: { by: { kind: 'human', id: 'ana' }, authority: { matched: 'finance', roles: ['finance', 'employee'], tenantId: 'acme' } },
        });
    });

    it('a person without the role does not: the call does not run and the refusal says why', async () => {
        const { engine, paid, audit } = build([pay(15_000), { content: 'done' }], { approver: approverAs('intern-17'), approverDirectory: directory });
        await engine.run('pay');
        expect(paid).toEqual([]);
        expect(lastEvent(audit)).toMatchObject({ decision: 'deny', reason: expect.stringContaining('does not have the role finance') });
    });

    it('the person who asked cannot approve with a role they do not hold', async () => {
        const { engine, paid } = build([pay(15_000), { content: 'done' }], { approver: approverAs('carlos'), approverDirectory: directory });
        await engine.run('pay');
        expect(paid).toEqual([]);
    });

    it('fails closed: with no directory the approval is refused, however the approver answered', async () => {
        const { engine, paid, audit } = build([pay(15_000), { content: 'done' }], { approver: approverAs('ana') });
        await engine.run('pay');
        expect(paid).toEqual([]);
        expect(lastEvent(audit)).toMatchObject({ decision: 'deny', reason: expect.stringContaining('no approver directory is configured') });
    });

    it('fails closed: an id the directory does not know is refused', async () => {
        const { engine, paid, audit } = build([pay(15_000), { content: 'done' }], { approver: approverAs('stranger'), approverDirectory: directory });
        await engine.run('pay');
        expect(paid).toEqual([]);
        expect(lastEvent(audit)).toMatchObject({ reason: expect.stringContaining('not known to the approver directory') });
    });

    it('fails closed: a directory that throws is a refusal, not a pass', async () => {
        const broken: ApproverDirectory = { describe: () => { throw new Error('user service is down'); } };
        const { engine, paid, audit } = build([pay(15_000), { content: 'done' }], { approver: approverAs('ana'), approverDirectory: broken });
        await engine.run('pay');
        expect(paid).toEqual([]);
        expect(lastEvent(audit)).toMatchObject({ reason: expect.stringContaining('user service is down') });
    });

    it('the roles come from the directory, never from what the caller says: a role written in `by` counts for nothing', async () => {
        const liar: Approver = {
            ref: { kind: 'human', id: 'intern-17' },
            request: async () => ({ decision: 'approve', by: { kind: 'human', id: 'intern-17', roles: ['finance'] } as unknown as ApproverRef, at: new Date().toISOString() }),
        };
        const { engine, paid } = build([pay(15_000), { content: 'done' }], { approver: liar, approverDirectory: directory });
        await engine.run('pay');
        expect(paid).toEqual([]);
    });

    it('an approver of another tenant than the request is refused, even with the role', async () => {
        const { engine, paid, audit } = build([pay(15_000), { content: 'done' }], { approver: approverAs('otto'), approverDirectory: directory });
        await engine.run('pay');
        expect(paid).toEqual([]);
        expect(lastEvent(audit)).toMatchObject({ reason: expect.stringContaining('another tenant') });
    });

    it('an ask with no approverRoles works as before: no directory needed, nothing recorded about authority', async () => {
        const plain: ToolPolicy = { decide: () => ({ effect: 'ask', reason: 'always ask', accepts: ['human'] }) };
        const { engine, paid, audit } = build([pay(15_000), { content: 'done' }], { policy: plain, approver: approverAs('intern-17') });
        await engine.run('pay');
        expect(paid).toEqual([15_000]);
        expect(lastEvent(audit).approval).toEqual({ id: expect.any(String), by: { kind: 'human', id: 'intern-17' } });
    });

    describe('durable approvals: the role is checked when the approved call is run', () => {
        let dir: string;
        beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'approver-roles-')); });
        afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

        it('a person with the role resolves it and it runs once, with the authority in the audit', async () => {
            const store = new FileApprovalStore(dir);
            const { engine, paid, audit } = build([pay(15_000), { content: 'pending' }], { approvals: store, approverDirectory: directory });
            await engine.run('pay');
            const [pending] = await store.list({ status: 'pending' });
            expect(pending).toMatchObject({ approverRoles: ['finance'] });
            await store.resolve(pending.id, answer('ana'));
            await expect(engine.runApproved(pending.id)).resolves.toBe('paid');
            expect(paid).toEqual([15_000]);
            expect(audit.events.find(e => e.approval)).toMatchObject({ approval: { by: { id: 'ana' }, authority: { matched: 'finance' } } });
        });

        it('a person without the role resolves it and nothing runs: the approval is not accepted', async () => {
            const store = new FileApprovalStore(dir);
            const { engine, paid, audit } = build([pay(15_000), { content: 'pending' }], { approvals: store, approverDirectory: directory });
            await engine.run('pay');
            const [pending] = await store.list({ status: 'pending' });
            await store.resolve(pending.id, answer('intern-17'));
            await engine.runApproved(pending.id);
            expect(paid).toEqual([]);
            expect(lastEvent(audit)).toMatchObject({ decision: 'deny', reason: expect.stringContaining('does not have the role finance') });
        });

        it('with no directory configured when it is run, the stored approval is refused too', async () => {
            const store = new FileApprovalStore(dir);
            const first = build([pay(15_000), { content: 'pending' }], { approvals: store, approverDirectory: directory });
            await first.engine.run('pay');
            const [pending] = await store.list({ status: 'pending' });
            await store.resolve(pending.id, answer('ana'));
            const second = build([], { approvals: store });                         // restarted without the directory
            await second.engine.runApproved(pending.id);
            expect(second.paid).toEqual([]);
        });
    });
});

describe('combining policies that ask for roles', () => {
    const ask = (roles?: string[]) => ({ effect: 'ask' as const, reason: 'r', ...(roles ? { approverRoles: roles } : {}) });

    it('one ask keeps its roles', () => {
        expect(combineDecisions([ask(['finance'])])).toMatchObject({ effect: 'ask', approverRoles: ['finance'] });
    });

    it('two asks need what both ask for: the strictest, the intersection', () => {
        expect(combineDecisions([ask(['finance', 'cfo']), ask(['finance', 'legal'])])).toMatchObject({ effect: 'ask', approverRoles: ['finance'] });
    });

    it('an ask with no roles does not loosen another that has them', () => {
        expect(combineDecisions([ask(), ask(['finance'])])).toMatchObject({ effect: 'ask', approverRoles: ['finance'] });
    });

    it('roles no one can hold at once deny the call', () => {
        const d = combineDecisions([ask(['finance']), ask(['legal'])]);
        expect(d).toMatchObject({ effect: 'deny', reason: expect.stringContaining('no one can hold at once') });
    });
});

describe('approverAuthority', () => {
    const request = (roles?: string[], tenantId?: string) => ({
        principal: { agentId: 'main', sessionId: 's', chain: ['main'], ...(tenantId ? { tenantId } : {}) },
        ...(roles ? { approverRoles: roles } : {}),
    });
    const by: ApproverRef = { kind: 'human', id: 'ana' };

    it('asks nothing when the ask requires no roles', async () => {
        expect(await approverAuthority(by, request())).toEqual({});
        expect(await approverAuthority(by, request([]))).toEqual({});
    });

    it('accepts any one of the roles and says which', async () => {
        expect(await approverAuthority(by, request(['cfo', 'finance']), directory)).toEqual({ authority: { roles: ['finance', 'employee'], tenantId: 'acme', matched: 'finance' } });
    });

    it('does not compare tenants when either side has none', async () => {
        expect(await approverAuthority(by, request(['finance']), { describe: () => ({ roles: ['finance'] }) })).toMatchObject({ authority: { matched: 'finance' } });
        expect(await approverAuthority(by, request(['finance'], 'acme'), { describe: () => ({ roles: ['finance'] }) })).toMatchObject({ authority: { matched: 'finance' } });
    });
});
