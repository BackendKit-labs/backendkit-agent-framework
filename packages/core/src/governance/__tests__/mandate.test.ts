/** Mandates (SPEC-0043 F1): what a verified power of representation covers, and what happens to everything else. */
import { createBaseEngine } from '../../engine/createBaseEngine';
import { MemoryAuditSink } from '../audit';
import { mandatePolicy, mandateCovers, auditMandate, type Mandate, type MandateVerifier } from '../mandate';
import { combineDecisions } from '../policy';
import type { Principal, ToolCall } from '../types';
import type { AgentProfile, ToolDefinition } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent, type Turn } from '../../__tests__/helpers';

const now = new Date('2026-11-22T12:00:00Z');
const principal: Principal = { agentId: 'buyer', sessionId: 's', chain: ['buyer'], userId: 'carlos' };
const buy = { name: 'buy', description: '', parameters: {}, destructive: true, execute: async () => 'bought' } as ToolDefinition;
const call = (args: Record<string, unknown>): ToolCall => ({ tool: buy, args });

const mandate = (over: Partial<Mandate> = {}): Mandate => ({
    id: 'm-1', issuer: 'did:example:company', subject: 'carlos', agent: 'buyer', actions: ['buy'],
    limits: { amount: { max: 1000, currency: 'EUR' } }, validFrom: '2026-01-01T00:00:00Z', validUntil: '2027-01-01T00:00:00Z',
    evidence: 'eyJ.credential.signature', ...over,
});
const amountOf = (a: Record<string, unknown>) => ({ value: Number(a.amount), currency: String(a.currency) });
const verifier = (m: Mandate | string): MandateVerifier => ({ verify: async () => (typeof m === 'string' ? { ok: false, reason: m } : { ok: true, mandate: m }) });
const policy = (m: Mandate | string, extra = {}) => mandatePolicy({ verifier: verifier(m), amountOf, now: () => now, ...extra });

describe('mandateCovers', () => {
    const ok = (m: Mandate, args: Record<string, unknown> = { amount: 500, currency: 'EUR' }, p: Principal = principal) =>
        mandateCovers(m, p, call(args), { amountOf, now: () => now });

    it('covers a call inside the tool, the amount, the person, the agent and the dates', () => {
        expect(ok(mandate())).toEqual({ ok: true });
    });
    it('the amount is a ceiling, not a target: equal passes, above does not', () => {
        expect(ok(mandate(), { amount: 1000, currency: 'EUR' })).toEqual({ ok: true });
        expect(ok(mandate(), { amount: 1000.01, currency: 'EUR' })).toMatchObject({ ok: false, reason: expect.stringContaining('above the 1000') });
    });
    it('another currency, a negative or non numeric amount are out of scope', () => {
        expect(ok(mandate(), { amount: 10, currency: 'USD' })).toMatchObject({ ok: false });
        expect(ok(mandate(), { amount: -5, currency: 'EUR' })).toMatchObject({ ok: false });
        expect(ok(mandate(), { amount: Number.NaN, currency: 'EUR' })).toMatchObject({ ok: false });
    });
    it('a mandate that limits the amount covers nothing when the policy cannot measure it', () => {
        expect(mandateCovers(mandate(), principal, call({ amount: 1 }), { now: () => now })).toMatchObject({ ok: false, reason: expect.stringContaining('how much it spends') });
    });
    it('another tool, another agent, another person', () => {
        expect(ok(mandate({ actions: ['pay'] }))).toMatchObject({ ok: false });
        expect(ok(mandate({ agent: 'other' }))).toMatchObject({ ok: false, reason: expect.stringContaining('agent "other"') });
        expect(ok(mandate({ subject: 'ana' }))).toMatchObject({ ok: false, reason: expect.stringContaining('another person') });
    });
    it('without identity.userId the mandate cannot be matched to a person (unless asked not to)', () => {
        const anon: Principal = { ...principal, userId: undefined };
        expect(ok(mandate(), undefined, anon)).toMatchObject({ ok: false });
        expect(mandateCovers(mandate(), anon, call({ amount: 1, currency: 'EUR' }), { amountOf, now: () => now, requireSubject: false })).toEqual({ ok: true });
    });
    it('expired, not yet valid, or with dates that cannot be read', () => {
        expect(ok(mandate({ validUntil: '2026-06-01T00:00:00Z' }))).toMatchObject({ ok: false });
        expect(ok(mandate({ validFrom: '2027-01-01T00:00:00Z' }))).toMatchObject({ ok: false });
        expect(ok(mandate({ validUntil: 'next tuesday' }))).toMatchObject({ ok: false });
    });
    it("'*' covers every tool; resources need an extractor", () => {
        expect(ok(mandate({ actions: ['*'] }))).toEqual({ ok: true });
        const m = mandate({ resources: ['acct-1'] });
        expect(mandateCovers(m, principal, call({ amount: 1, currency: 'EUR' }), { amountOf, now: () => now })).toMatchObject({ ok: false });
        const resourceOf = (a: Record<string, unknown>) => String(a.account);
        expect(mandateCovers(m, principal, call({ amount: 1, currency: 'EUR', account: 'acct-1' }), { amountOf, resourceOf, now: () => now })).toEqual({ ok: true });
        expect(mandateCovers(m, principal, call({ amount: 1, currency: 'EUR', account: 'acct-2' }), { amountOf, resourceOf, now: () => now })).toMatchObject({ ok: false });
    });
});

describe('mandatePolicy', () => {
    const decide = (p: ReturnType<typeof mandatePolicy>, args: Record<string, unknown> = { amount: 500, currency: 'EUR' }) => p.decide(principal, call(args));

    it('inside the mandate: allow, and the decision carries what goes to the audit event', async () => {
        const d = await decide(policy(mandate()));
        expect(d).toMatchObject({ effect: 'allow', mandate: { id: 'm-1', issuer: 'did:example:company', subject: 'carlos' } });
    });
    it('the audit mandate keeps the hash of the credential, never the credential', () => {
        const a = auditMandate(mandate());
        expect(a.evidenceHash).toMatch(/^[0-9a-f]{64}$/);
        expect(JSON.stringify(a)).not.toContain('eyJ.credential');
    });
    it('no valid mandate: deny, with the reason of the verifier', async () => {
        expect(await decide(policy('credential revoked'))).toEqual({ effect: 'deny', reason: 'no valid mandate: credential revoked' });
    });
    it('a verifier that throws or answers nonsense is a deny', async () => {
        const boom: MandateVerifier = { verify: async () => { throw new Error('network down'); } };
        expect(await decide(mandatePolicy({ verifier: boom, amountOf }))).toMatchObject({ effect: 'deny', reason: expect.stringContaining('network down') });
        const junk = { verify: async () => ({ ok: true }) } as unknown as MandateVerifier;
        expect(await decide(mandatePolicy({ verifier: junk, amountOf }))).toMatchObject({ effect: 'deny' });
    });
    it('a valid mandate that does not cover the call: ask a human by default, deny when told to', async () => {
        expect(await decide(policy(mandate()), { amount: 5000, currency: 'EUR' })).toMatchObject({ effect: 'ask', accepts: ['human'] });
        expect(await decide(policy(mandate(), { outOfScope: 'deny' }), { amount: 5000, currency: 'EUR' })).toMatchObject({ effect: 'deny' });
    });
    it('combined with another policy, an ask beats the allow of the mandate, and the mandate survives an allow', async () => {
        const allow = await decide(policy(mandate()));
        expect(combineDecisions([allow, { effect: 'allow' }])).toMatchObject({ effect: 'allow', mandate: { id: 'm-1' } });
        expect(combineDecisions([allow, { effect: 'ask', reason: 'x' }]).effect).toBe('ask');
    });
});

describe('in the engine', () => {
    const agent: AgentProfile = { ...testAgent, id: 'buyer', allowedTools: ['buy'], delegatesTo: [] };
    const turn = (amount: number): Turn => ({ tool_calls: [{ id: 'c', name: 'buy', args: { amount, currency: 'EUR' } }] });
    function run(amount: number, m: Mandate | string) {
        const audit = new MemoryAuditSink();
        const bought: unknown[] = [];
        const tool: ToolDefinition = { ...buy, execute: async (a) => { bought.push(a); return 'bought'; } };
        const { transport } = createMockTransport();
        const engine = createBaseEngine({ requireAgentIdentity: false,
            providers: { mock: createScriptedProvider([turn(amount), { content: 'done' }]) }, defaultProvider: 'mock',
            agents: [agent], defaultAgent: 'buyer', tools: [tool], transport, workingDir: process.cwd(), iterationMode: 'auto',
            policy: policy(m), audit, identity: { userId: 'carlos' },
        } as never);
        return { engine, audit, bought };
    }

    it('a purchase inside the mandate runs with nobody asked, and the audit event names the mandate', async () => {
        const { engine, audit, bought } = run(500, mandate());
        await engine.run('buy a tv');
        expect(bought).toHaveLength(1);
        const ev = audit.events.find(e => e.tool === 'buy')!;
        expect(ev.decision).toBe('allow');
        expect(ev.mandate).toMatchObject({ id: 'm-1', subject: 'carlos' });
        expect(ev.approval).toBeUndefined();
    });
    it('above the limit it does not run: nobody is configured to approve', async () => {
        const { engine, bought } = run(5000, mandate());
        await engine.run('buy a tv');
        expect(bought).toHaveLength(0);
    });
    it('with no valid mandate nothing runs, and the audit event says why', async () => {
        const { engine, audit, bought } = run(10, 'credential revoked');
        await engine.run('buy a tv');
        expect(bought).toHaveLength(0);
        const ev = audit.events.find(e => e.tool === 'buy')!;
        expect(ev.decision).toBe('deny');
        expect(ev.reason).toContain('credential revoked');
        expect(ev.mandate).toBeUndefined();
    });
});

describe('a mandate bound to the identity of the agent (SPEC-0044 F3)', () => {
    const withId = (id?: string): Principal => ({ ...principal, ...(id ? { agentIdentity: { id } } : {}) });
    const args = { amount: 5, currency: 'EUR' };

    it('covers the agent whose identity it names and refuses another one, or an agent with none', () => {
        const m = mandate({ agentIdentity: 'did:ex:buyer' });
        expect(mandateCovers(m, withId('did:ex:buyer'), call(args), { amountOf, now: () => now })).toEqual({ ok: true });
        expect(mandateCovers(m, withId('did:ex:other'), call(args), { amountOf, now: () => now })).toMatchObject({ ok: false, reason: expect.stringContaining('another agent identity') });
        expect(mandateCovers(m, withId(), call(args), { amountOf, now: () => now })).toMatchObject({ ok: false, reason: expect.stringContaining('has none') });
    });
    it('a mandate that names no identity does not look at it', () => {
        expect(mandateCovers(mandate(), withId('did:ex:anything'), call(args), { amountOf, now: () => now })).toEqual({ ok: true });
    });
    it('the audit says which identity and whether possession was proven; a bearer credential is marked none', () => {
        expect(auditMandate(mandate({ agentIdentity: 'did:ex:buyer', holderBinding: 'proven' }))).toMatchObject({ agentIdentity: 'did:ex:buyer', holderBinding: 'proven' });
        expect(auditMandate(mandate())).toMatchObject({ holderBinding: 'none' });
        expect(auditMandate(mandate())).not.toHaveProperty('agentIdentity');
    });

    describe('proof of possession and the policy', () => {
        const seen: Array<{ hasProve: boolean }> = [];
        const spying = (m: Mandate): MandateVerifier => ({ verify: async (req) => { seen.push({ hasProve: typeof req.prove === 'function' }); return { ok: true, mandate: m }; } });
        beforeEach(() => { seen.length = 0; });

        it('hands the verifier a prove function that signs with the provider, only with an identity and a provider that can sign', async () => {
            const sign = jest.fn(async () => ({ kid: 'k', signature: 'sig' }));
            const p = mandatePolicy({ verifier: spying(mandate()), amountOf, now: () => now, agentIdentity: { sign } });
            await p.decide(withId('did:ex:buyer'), call(args));
            await p.decide(withId(), call(args));
            await mandatePolicy({ verifier: spying(mandate()), amountOf, now: () => now }).decide(withId('did:ex:buyer'), call(args));
            expect(seen.map(s => s.hasProve)).toEqual([true, false, false]);
            // and it signs for THIS agent
            const proveReq = [] as Array<NonNullable<Parameters<MandateVerifier['verify']>[0]['prove']>>;
            await mandatePolicy({ verifier: { verify: async r => { proveReq.push(r.prove!); return { ok: true, mandate: mandate() }; } }, amountOf, now: () => now, agentIdentity: { sign } }).decide(withId('did:ex:buyer'), call(args));
            await expect(proveReq[0]!(Buffer.from('c'))).resolves.toEqual({ kid: 'k', signature: 'sig' });
            expect(sign).toHaveBeenCalledWith('buyer', expect.any(Buffer), expect.objectContaining({ sessionId: 's', userId: 'carlos' }));
        });
        it('requireHolderBinding refuses a bearer credential and accepts a proven one; by default both pass and the audit tells', async () => {
            const bearer = policy(mandate(), { requireHolderBinding: true });
            expect(await bearer.decide(principal, call(args))).toMatchObject({ effect: 'deny', reason: expect.stringContaining('proof of possession') });
            expect(await policy(mandate({ holderBinding: 'proven' }), { requireHolderBinding: true }).decide(principal, call(args))).toMatchObject({ effect: 'allow', mandate: { holderBinding: 'proven' } });
            expect(await policy(mandate()).decide(principal, call(args))).toMatchObject({ effect: 'allow', mandate: { holderBinding: 'none' } });
        });
    });
});

describe('a mandate for another agent identity is a refusal, not "out of scope" (SPEC-0044 F3)', () => {
    const args = { amount: 5, currency: 'EUR' };
    const other: Principal = { ...principal, agentIdentity: { id: 'did:ex:other' } };

    it('is denied even when out of scope would ask a person (the default), and says why', async () => {
        const p = policy(mandate({ agentIdentity: 'did:ex:buyer' }));
        expect(await p.decide(other, call(args))).toMatchObject({ effect: 'deny', reason: expect.stringMatching(/no valid mandate.*another agent identity/) });
    });
    it('an agent with no identity is denied too, and the right identity is allowed', async () => {
        const p = policy(mandate({ agentIdentity: 'did:ex:buyer' }));
        expect(await p.decide(principal, call(args))).toMatchObject({ effect: 'deny' });
        expect(await p.decide({ ...principal, agentIdentity: { id: 'did:ex:buyer' } }, call(args))).toMatchObject({ effect: 'allow' });
    });
});

describe('who may decide what the mandate does not cover (outOfScopeApprover)', () => {
    const args = { amount: 5000, currency: 'EUR' };   // above the 1000 of the mandate

    describe('the ask it returns', () => {
        it('by default asks any human, with no role: nothing changes for who does not configure it', async () => {
            expect(await policy(mandate()).decide(principal, call(args))).toEqual({ effect: 'ask', reason: expect.stringContaining('outside the mandate'), accepts: ['human'] });
        });
        it('carries the roles, the kinds and the time limit that were configured', async () => {
            const d = await policy(mandate(), { outOfScopeApprover: { approverRoles: ['finance'], accepts: ['human'], ttlSeconds: 600 } }).decide(principal, call(args));
            expect(d).toMatchObject({ effect: 'ask', accepts: ['human'], approverRoles: ['finance'], ttlSeconds: 600 });
        });
        it('a mandate that covers the call is not asked: the roles are only for what is outside it', async () => {
            expect(await policy(mandate(), { outOfScopeApprover: { approverRoles: ['finance'] } }).decide(principal, call({ amount: 5, currency: 'EUR' }))).toMatchObject({ effect: 'allow' });
        });
        it('with outOfScope deny it is a deny, whatever it says about approvers', async () => {
            expect(await policy(mandate(), { outOfScope: 'deny', outOfScopeApprover: { approverRoles: ['finance'] } }).decide(principal, call(args))).toMatchObject({ effect: 'deny' });
        });
        it('a rule about who approves that is wrong fails when the policy is built, not "anyone" or "no one" at the first call', () => {
            const build = (outOfScopeApprover: unknown) => () => policy(mandate(), { outOfScopeApprover });
            expect(build({ approverRoles: [] })).toThrow(/at least one role/);
            expect(build({ approverRoles: [''] })).toThrow(/none of them empty/);
            expect(build({ approverRoles: 'finance' })).toThrow(/list/);
            expect(build({ accepts: [] })).toThrow(/at least one kind/);
            expect(build({ ttlSeconds: 0 })).toThrow(/positive/);
            expect(build({ ttlSeconds: Number.NaN })).toThrow(/positive/);
        });
    });

    describe('in the engine, with a directory of people and four eyes', () => {
        const people: Record<string, { roles: string[] }> = { ana: { roles: ['finance'] }, carlos: { roles: ['finance'] }, intern: { roles: ['intern'] } };
        const agent: AgentProfile = { ...testAgent, id: 'buyer', allowedTools: ['buy'], delegatesTo: [] };

        async function bought(approverId: string, over: Record<string, unknown> = {}) {
            const done: unknown[] = [];
            const tool: ToolDefinition = { ...buy, execute: async (a) => { done.push(a); return 'bought'; } };
            const { transport } = createMockTransport();
            const engine = createBaseEngine({
                requireAgentIdentity: false,
                providers: { mock: createScriptedProvider([{ tool_calls: [{ id: 'c', name: 'buy', args }] }, { content: 'done' }]) }, defaultProvider: 'mock',
                agents: [agent], defaultAgent: 'buyer', tools: [tool], transport, workingDir: process.cwd(), iterationMode: 'auto',
                policy: policy(mandate(), { outOfScopeApprover: { approverRoles: ['finance'] } }), identity: { userId: 'carlos' },
                approverDirectory: { describe: (by: { id: string }) => people[by.id] }, forbidSelfApproval: true,
                approver: { ref: { kind: 'human', id: approverId }, request: async () => ({ decision: 'approve', by: { kind: 'human', id: approverId }, at: new Date().toISOString() }) },
                ...over,
            } as never);
            await engine.run('buy a tv');
            return done;
        }

        it('a person with the role approves and the order runs', async () => expect(await bought('ana')).toHaveLength(1));
        it('a person without the role does not, even though they are a person and not the requester', async () => expect(await bought('intern')).toHaveLength(0));
        it('the requester does not, even with the role (four eyes)', async () => expect(await bought('carlos')).toHaveLength(0));
        it('a person the directory does not know does not', async () => expect(await bought('stranger')).toHaveLength(0));
        it('with no directory nobody can: roles that cannot be checked are not roles', async () => expect(await bought('ana', { approverDirectory: undefined })).toHaveLength(0));
    });
});
