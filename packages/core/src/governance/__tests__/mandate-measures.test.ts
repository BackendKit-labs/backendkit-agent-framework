/**
 * SPEC-0045 F1. A mandate caps what is critical, and not only money: any quantity of a call that the operator knows how to measure (the rows it
 * deletes, the recipients it writes to). And the mandate is required only for the tools the operator says (`appliesTo`); the others are somebody
 * else's decision and the verifier is not even asked.
 */
import { createBaseEngine } from '../../engine/createBaseEngine';
import { MemoryAuditSink } from '../audit';
import { mandateCovers, mandatePolicy, type Mandate, type MandateVerifier } from '../mandate';
import { defaultToolPolicy } from '../policy';
import type { Principal, ToolCall, ToolPolicy } from '../types';
import type { AgentProfile, ToolDefinition } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent } from '../../__tests__/helpers';

const now = new Date('2026-11-24T12:00:00Z');
const principal: Principal = { agentId: 'cleaner', sessionId: 's', chain: ['cleaner'], userId: 'carlos' };
const purge = { name: 'purge', description: '', parameters: {}, destructive: true, execute: async () => 'purged' } as ToolDefinition;
const lookup = { name: 'lookup', description: '', parameters: {}, readOnly: true, execute: async () => 'found' } as ToolDefinition;
const undeclared = { name: 'tweak', description: '', parameters: {}, execute: async () => 'tweaked' } as ToolDefinition;
const call = (args: Record<string, unknown>, tool: ToolDefinition = purge): ToolCall => ({ tool, args });

const mandate = (over: Partial<Mandate> = {}): Mandate => ({
    id: 'm-1', issuer: 'did:example:company', subject: 'carlos', agent: 'cleaner', actions: ['purge'],
    validFrom: '2026-01-01T00:00:00Z', validUntil: '2027-01-01T00:00:00Z', evidence: 'eyJ.credential.signature', ...over,
});
const rows = (args: Record<string, unknown>) => (Array.isArray(args.ids) ? { value: args.ids.length, unit: 'rows' } : undefined);
const measureOf = { rows };
const ids = (n: number) => ({ ids: Array.from({ length: n }, (_, i) => `r${i}`) });
const covers = (m: Mandate, args: Record<string, unknown>, extra: Parameters<typeof mandateCovers>[3] = {}) =>
    mandateCovers(m, principal, call(args), { measureOf, now: () => now, ...extra });

describe('measures: a cap per operation on anything the operator can measure', () => {
    const capped = (max = 100, unit: string | null = 'rows') => mandate({ limits: { measures: [{ name: 'rows', max, ...(unit ? { unit } : {}) }] } });

    it('a call inside the cap is covered, and the cap itself is a ceiling, not a target', () => {
        expect(covers(capped(), ids(50))).toEqual({ ok: true });
        expect(covers(capped(), ids(100))).toEqual({ ok: true });
        expect(covers(capped(), ids(101))).toMatchObject({ ok: false, reason: expect.stringContaining('the rows 101 is above the 100') });
    });

    it('the unit is part of the cap, like the currency of an amount; with no unit in the mandate any unit does', () => {
        expect(covers(capped(100, 'rows'), { ids: ['a'] }, { measureOf: { rows: () => ({ value: 1, unit: 'kg' }) } })).toMatchObject({ ok: false, reason: expect.stringContaining('in rows and the call in kg') });
        expect(covers(capped(100, null), { ids: ['a'] }, { measureOf: { rows: () => ({ value: 1, unit: 'kg' }) } })).toEqual({ ok: true });
    });

    it('fails closed on what it cannot read: no way to measure, a call that does not say, a measurer that fails, a negative or NaN value', () => {
        expect(covers(capped(), ids(1), { measureOf: {} })).toMatchObject({ ok: false, reason: expect.stringContaining('does not know how to measure') });
        expect(covers(capped(), ids(1), { measureOf: undefined })).toMatchObject({ ok: false });
        expect(covers(capped(), { other: 1 })).toMatchObject({ ok: false, reason: expect.stringContaining('does not say how much') });
        expect(covers(capped(), ids(1), { measureOf: { rows: () => { throw new Error('boom'); } } })).toMatchObject({ ok: false, reason: expect.stringContaining('measuring "rows" failed: boom') });
        expect(covers(capped(), ids(1), { measureOf: { rows: () => ({ value: -1, unit: 'rows' }) } })).toMatchObject({ ok: false, reason: expect.stringContaining('not a valid number') });
        expect(covers(capped(), ids(1), { measureOf: { rows: () => ({ value: Number.NaN, unit: 'rows' }) } })).toMatchObject({ ok: false });
    });

    it('a cap that cannot be read well covers nothing: bad name, the reserved "amount", a repeated name, a bad maximum', () => {
        const bad = (measures: unknown) => covers(mandate({ limits: { measures } as never }), ids(1), { measureOf: { rows, Rows: rows, amount: rows, constructor: rows } as never });
        expect(bad([{ name: 'Rows', max: 1 }])).toMatchObject({ ok: false, reason: expect.stringContaining('no valid name') });
        expect(bad([{ name: 'amount', max: 1 }])).toMatchObject({ ok: false, reason: expect.stringContaining('no valid name') });
        expect(bad([{ name: 'a'.repeat(33), max: 1 }])).toMatchObject({ ok: false });
        expect(bad([{ name: 'rows', max: 5 }, { name: 'rows', max: 9 }])).toMatchObject({ ok: false, reason: expect.stringContaining('more than once') });
        expect(bad([{ name: 'rows', max: -1 }])).toMatchObject({ ok: false, reason: expect.stringContaining('not a valid number') });
        expect(bad([{ name: 'rows', max: Number.NaN }])).toMatchObject({ ok: false });
        expect(bad([{ name: 'rows', max: '5' }])).toMatchObject({ ok: false });
        expect(bad('rows')).toMatchObject({ ok: false, reason: expect.stringContaining('not a list') });
    });

    it('a name that is a property of every object is not a way to find a measurer', () => {
        const m = mandate({ limits: { measures: [{ name: 'constructor', max: 1 }] } });
        expect(covers(m, ids(1), { measureOf: {} })).toMatchObject({ ok: false, reason: expect.stringContaining('does not know how to measure') });
    });

    it('every cap must hold, and the amount keeps working next to them', () => {
        const both = mandate({ limits: { amount: { max: 1000, currency: 'EUR' }, measures: [{ name: 'rows', max: 10 }, { name: 'targets', max: 2 }] } });
        const opts = { measureOf: { rows, targets: (a: Record<string, unknown>) => ({ value: Number(a.targets) }) }, amountOf: (a: Record<string, unknown>) => ({ value: Number(a.amount), currency: 'EUR' }) };
        expect(covers(both, { ...ids(5), targets: 2, amount: 10 }, opts)).toEqual({ ok: true });
        expect(covers(both, { ...ids(5), targets: 3, amount: 10 }, opts)).toMatchObject({ ok: false, reason: expect.stringContaining('targets 3') });
        expect(covers(both, { ...ids(5), targets: 1, amount: 5000 }, opts)).toMatchObject({ ok: false, reason: expect.stringContaining('amount 5000') });
    });

    it('a mandate with no measures behaves as before', () => {
        expect(covers(mandate(), ids(100_000))).toEqual({ ok: true });
    });
});

describe('measures in the policy: over the cap a person decides, like over an amount', () => {
    const verifier = (m: Mandate): MandateVerifier => ({ verify: async () => ({ ok: true, mandate: m }) });
    const policy = (extra = {}) => mandatePolicy({ verifier: verifier(mandate({ limits: { measures: [{ name: 'rows', max: 100, unit: 'rows' }] } })), measureOf, now: () => now, ...extra });

    it('inside: allow with the mandate. Above: ask a person, and the ask says which mandate it went beyond', async () => {
        expect(await policy().decide(principal, call(ids(10)))).toMatchObject({ effect: 'allow', mandate: { id: 'm-1' } });
        expect(await policy().decide(principal, call(ids(500)))).toMatchObject({
            effect: 'ask', reason: expect.stringContaining('the rows 500 is above the 100'), exceeds: { id: 'm-1' },
        });
        expect(await policy({ outOfScope: 'deny' }).decide(principal, call(ids(500)))).toMatchObject({ effect: 'deny' });
    });
});

describe('appliesTo and otherwise: the mandate is required for what is critical', () => {
    const calls = { n: 0 };
    const counting = (m: Mandate): MandateVerifier => ({ verify: async () => { calls.n++; return { ok: true, mandate: m }; } });
    const make = (extra: Record<string, unknown> = {}) => mandatePolicy({ verifier: counting(mandate()), now: () => now, appliesTo: (t: ToolDefinition) => t.destructive === true, ...extra } as never);
    beforeEach(() => { calls.n = 0; });

    it('a tool the policy applies to goes through the mandate as always', async () => {
        expect(await make().decide(principal, call({}, purge))).toMatchObject({ effect: 'allow', mandate: { id: 'm-1' } });
        expect(calls.n).toBe(1);
    });

    it('a tool it does not apply to is decided by the default policy, and the verifier is not asked', async () => {
        expect(await make().decide(principal, call({}, lookup))).toEqual(await defaultToolPolicy.decide(principal, call({}, lookup)));
        expect(await make().decide(principal, call({}, lookup))).toMatchObject({ effect: 'allow' });
        expect(calls.n).toBe(0);
    });

    it('forgetting to include a tool is annoying, never permissive: one that declares nothing asks a person', async () => {
        expect(await make().decide(principal, call({}, undeclared))).toMatchObject({ effect: 'ask' });
        const everythingIsCritical = make({ appliesTo: (t: ToolDefinition) => t.name === 'purge' });
        expect(await everythingIsCritical.decide(principal, call({}, undeclared))).toMatchObject({ effect: 'ask' });
        expect(calls.n).toBe(0);
    });

    it('a destructive tool left out still asks a person: leaving it out does not make it free', async () => {
        const none = make({ appliesTo: () => false });
        expect(await none.decide(principal, call({}, purge))).toMatchObject({ effect: 'ask', accepts: ['human'] });
        expect(calls.n).toBe(0);
    });

    it('otherwise can be the operator\'s own policy', async () => {
        const mine: ToolPolicy = { decide: (_p, c) => (c.tool.name === 'lookup' ? { effect: 'deny', reason: 'lookups are closed today' } : { effect: 'allow' }) };
        expect(await make({ otherwise: mine }).decide(principal, call({}, lookup))).toEqual({ effect: 'deny', reason: 'lookups are closed today' });
    });

    it('without appliesTo it is required for every call, as before', async () => {
        const all = mandatePolicy({ verifier: counting(mandate({ actions: ['purge'] })), now: () => now });
        expect(await all.decide(principal, call({}, lookup))).toMatchObject({ effect: 'ask' });     // a valid mandate that does not cover it
        expect(calls.n).toBe(1);
    });

    it('a predicate that throws denies the call; a predicate or a policy that is not one fails when the policy is built', async () => {
        const broken = make({ appliesTo: () => { throw new Error('no list'); } });
        expect(await broken.decide(principal, call({}, purge))).toMatchObject({ effect: 'deny', reason: expect.stringContaining('appliesTo failed: no list') });
        expect(() => make({ appliesTo: 'critical' })).toThrow(/appliesTo has to be a function/);
        expect(() => make({ otherwise: {} })).toThrow(/otherwise has to be a ToolPolicy/);
    });
});

describe('in the engine: an agent reads with no power and acts only under one', () => {
    const agent: AgentProfile = { ...testAgent, id: 'cleaner', allowedTools: ['lookup', 'purge'], delegatesTo: [] };
    async function run(turns: Array<{ name: string; args: Record<string, unknown> }>, m: Mandate | undefined) {
        const audit = new MemoryAuditSink();
        const ran: string[] = [];
        const tools = [{ ...lookup, execute: async () => { ran.push('lookup'); return 'found'; } }, { ...purge, execute: async () => { ran.push('purge'); return 'purged'; } }] as ToolDefinition[];
        const script = [...turns.map((t, i) => ({ tool_calls: [{ id: `c${i}`, name: t.name, args: t.args }] })), { content: 'done' }];
        const { transport } = createMockTransport();
        const engine = createBaseEngine({
            requireAgentIdentity: false, providers: { mock: createScriptedProvider(script) }, defaultProvider: 'mock', agents: [agent], defaultAgent: 'cleaner', tools,
            transport, workingDir: process.cwd(), iterationMode: 'auto', audit, identity: { userId: 'carlos' },
            policy: mandatePolicy({
                verifier: { verify: async () => (m ? { ok: true, mandate: m } : { ok: false, reason: 'holds no mandate' }) }, measureOf, now: () => now,
                appliesTo: (t) => t.destructive === true,
            }),
        } as never);
        await engine.run('clean');
        return { ran, audit };
    }
    const capped = mandate({ limits: { measures: [{ name: 'rows', max: 100, unit: 'rows' }] } });

    it('a read runs with no mandate at all; a purge inside the cap runs under the mandate and the audit names it', async () => {
        const { ran, audit } = await run([{ name: 'lookup', args: {} }, { name: 'purge', args: ids(10) }], capped);
        expect(ran).toEqual(['lookup', 'purge']);
        expect(audit.events.find(e => e.tool === 'lookup')).toMatchObject({ decision: 'allow' });
        expect(audit.events.find(e => e.tool === 'lookup')?.mandate).toBeUndefined();
        expect(audit.events.find(e => e.tool === 'purge')).toMatchObject({ decision: 'allow', mandate: { id: 'm-1' } });
    });

    it('with no mandate the read still runs and the purge does not', async () => {
        const { ran, audit } = await run([{ name: 'lookup', args: {} }, { name: 'purge', args: ids(10) }], undefined);
        expect(ran).toEqual(['lookup']);
        expect(audit.events.find(e => e.tool === 'purge')).toMatchObject({ decision: 'deny', reason: expect.stringContaining('holds no mandate') });
    });

    it('a purge above the cap does not run: nobody is configured to approve', async () => {
        const { ran } = await run([{ name: 'purge', args: ids(500) }], capped);
        expect(ran).toEqual([]);
    });
});
