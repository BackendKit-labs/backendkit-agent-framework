/** A stored approval request can expire, and an expired one is not run (SPEC-0042 F3). */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBaseEngine, type BaseEngineOptions } from '../createBaseEngine';
import { FileApprovalStore } from '../../governance/approval-store';
import { MemoryAuditSink } from '../../governance/audit';
import { combineDecisions } from '../../governance/policy';
import type { ApprovalOutcome, Approver, ToolPolicy } from '../../governance/types';
import type { AgentProfile, ToolDefinition } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent, type Turn } from '../../__tests__/helpers';

const main: AgentProfile = { ...testAgent, id: 'main', allowedTools: ['pay'], delegatesTo: [] };

const policyWith = (ttlSeconds?: number): ToolPolicy => ({
    decide: (_principal, call) => (Number(call.args.amount) > 10_000
        ? { effect: 'ask', reason: 'payment above 10k', accepts: ['human'], ...(ttlSeconds !== undefined ? { ttlSeconds } : {}) }
        : { effect: 'allow' }),
});

const pay = (amount: number): Turn => ({ tool_calls: [{ id: 'c1', name: 'pay', args: { amount } }] });
const answer = (id: string): ApprovalOutcome => ({ decision: 'approve', by: { kind: 'human', id }, at: new Date().toISOString() });

function build(script: Turn[], extra: Partial<BaseEngineOptions> = {}, ttlSeconds?: number) {
    const paid: number[] = [];
    const audit = new MemoryAuditSink();
    const tools: ToolDefinition[] = [
        { name: 'pay', description: '', parameters: { type: 'object' }, execute: async (a) => { paid.push(Number((a as { amount: number }).amount)); return 'paid'; } },
    ];
    const { transport } = createMockTransport();
    const engine = createBaseEngine({
        providers: { mock: createScriptedProvider(script) }, defaultProvider: 'mock', agents: [main], defaultAgent: 'main',
        tools, transport, workingDir: process.cwd(), iterationMode: 'auto', audit, policy: policyWith(ttlSeconds), ...extra,
    });
    return { engine, paid, audit };
}

const lastEvent = (audit: MemoryAuditSink) => audit.events[audit.events.length - 1];

describe('approval expiry', () => {
    let dir: string;
    let realNow: () => number;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'approval-expiry-')); realNow = Date.now.bind(Date); });
    afterEach(() => { jest.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }); });

    /** Time moves on: `Date.now()` answers as if `seconds` had passed since now. */
    const later = (seconds: number) => { const base = realNow(); jest.spyOn(Date, 'now').mockImplementation(() => base + seconds * 1000); };

    async function pending(extra: Partial<BaseEngineOptions>, ttlSeconds?: number) {
        const store = new FileApprovalStore(dir);
        const built = build([pay(15_000), { content: 'pending' }], { approvals: store, ...extra }, ttlSeconds);
        await built.engine.run('pay');
        const all = await store.list({ status: 'pending' });
        return { ...built, store, request: all[all.length - 1]! };         // the newest: this call's
    }

    it('by default nothing expires: an approval is run a year later, as before', async () => {
        const { engine, paid, store, request } = await pending({});
        expect(request.expiresAt).toBeUndefined();
        await store.resolve(request.id, answer('ana'));
        later(365 * 24 * 3600);
        await expect(engine.runApproved(request.id)).resolves.toBe('paid');
        expect(paid).toEqual([15_000]);
    });

    it('with approvalTtlSeconds the stored request carries when it expires', async () => {
        const before = realNow();
        const { request } = await pending({ approvalTtlSeconds: 60 });
        expect(Date.parse(request.expiresAt!)).toBeGreaterThanOrEqual(before + 60_000);
        expect(Date.parse(request.expiresAt!)).toBeLessThan(realNow() + 61_000);
    });

    it('an approval inside the window runs', async () => {
        const { engine, paid, store, request } = await pending({ approvalTtlSeconds: 60 });
        await store.resolve(request.id, answer('ana'));
        later(30);
        await expect(engine.runApproved(request.id)).resolves.toBe('paid');
        expect(paid).toEqual([15_000]);
    });

    it('an approval after the window is not run, and the refusal is audited with its reason', async () => {
        const { engine, paid, audit, store, request } = await pending({ approvalTtlSeconds: 60 });
        await store.resolve(request.id, answer('ana'));
        later(61);
        await engine.runApproved(request.id);
        expect(paid).toEqual([]);
        expect(lastEvent(audit)).toMatchObject({ tool: 'pay', decision: 'deny', reason: expect.stringContaining('expired at') });
    });

    it('an expired request is spent: it cannot be tried again, a new one has to be made', async () => {
        const { engine, store, request } = await pending({ approvalTtlSeconds: 60 });
        await store.resolve(request.id, answer('ana'));
        later(61);
        await engine.runApproved(request.id);
        await expect(engine.runApproved(request.id)).rejects.toThrow(/already executed/);
    });

    it('a request that expired while pending cannot be approved after the fact', async () => {
        const { engine, paid, store, request } = await pending({ approvalTtlSeconds: 60 });
        later(3600);                                                      // nobody answered for an hour
        await store.resolve(request.id, answer('ana'));                   // someone approves it late
        await engine.runApproved(request.id);
        expect(paid).toEqual([]);
    });

    it('the ask can set its own ttl, and the shorter one wins', async () => {
        const policyShorter = await pending({ approvalTtlSeconds: 3600 }, 10);
        const t1 = Date.parse(policyShorter.request.expiresAt!) - realNow();
        expect(t1).toBeLessThanOrEqual(10_000);
        const engineShorter = await pending({ approvalTtlSeconds: 5 }, 3600);
        const t2 = Date.parse(engineShorter.request.expiresAt!) - realNow();
        expect(t2).toBeLessThanOrEqual(5_000);
    });

    it('a ttl that is not a positive number expires at once: a mistake does not turn into "never expires"', async () => {
        const { engine, paid, store, request } = await pending({}, 0);
        expect(request.expiresAt).toBeDefined();
        await store.resolve(request.id, answer('ana'));
        later(1);
        await engine.runApproved(request.id);
        expect(paid).toEqual([]);
    });

    it('an expiry that cannot be read counts as expired', async () => {
        const { engine, paid, store, request } = await pending({ approvalTtlSeconds: 3600 });
        await store.resolve(request.id, answer('ana'));
        const file = readdirSync(dir).map(f => join(dir, f)).find(f => readFileSync(f, 'utf8').includes(request.id))!;
        writeFileSync(file, readFileSync(file, 'utf8').replace(request.expiresAt!, 'not-a-date'));
        await engine.runApproved(request.id);
        expect(paid).toEqual([]);
    });

    it('an approver that answers right away is not affected: there is no window to wait out', async () => {
        const approver: Approver = { ref: { kind: 'human', id: 'ana' }, request: async () => answer('ana') };
        const { engine, paid } = build([pay(15_000), { content: 'done' }], { approver, approvalTtlSeconds: 60 });
        await engine.run('pay');
        expect(paid).toEqual([15_000]);
    });

    it('a bad engine option is refused', () => {
        for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(() => build([], { approvalTtlSeconds: bad })).toThrow(/approvalTtlSeconds/);
        }
    });
});

describe('combining policies that set a ttl', () => {
    const ask = (ttlSeconds?: number) => ({ effect: 'ask' as const, reason: 'r', ...(ttlSeconds !== undefined ? { ttlSeconds } : {}) });
    it('the shortest wins, and an ask with no ttl does not lengthen another', () => {
        expect(combineDecisions([ask(600), ask(60)])).toMatchObject({ ttlSeconds: 60 });
        expect(combineDecisions([ask(), ask(60)])).toMatchObject({ ttlSeconds: 60 });
        expect(combineDecisions([ask(), ask()])).not.toHaveProperty('ttlSeconds');
    });
});
