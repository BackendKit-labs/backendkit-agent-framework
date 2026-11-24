/**
 * SPEC-0045 F2: the second profile of the credential (`vct` 2) carries `limits.measures`. What matters is that a cap can never be accepted and
 * dropped: the first profile refuses it, a verifier that only knows the first refuses a credential of the second, and anything it does not
 * understand inside a measure is refused. Then, with a real engine, the cap is enforced.
 */
import { generateKeyPairSync } from 'node:crypto';
import { createBaseEngine, mandatePolicy, MemoryAuditSink, type AgentProfile, type ToolDefinition } from '@backendkit-labs/agent-core';
import { checkPowers, issueMandate, jwtMandateVerifier, MANDATE_VCT, MANDATE_VCT_V2, signJws } from '../index';

const issuer = generateKeyPairSync('ed25519');
const nowS = Math.floor(Date.now() / 1000);
const request = { principal: { agentId: 'cleaner', sessionId: 's', chain: ['cleaner'], userId: 'carlos' }, call: { tool: { name: 'purge' } as never, args: {} } };

const credential = (over: Record<string, unknown> = {}) => issueMandate({
    privateKey: issuer.privateKey, alg: 'EdDSA', issuer: 'did:example:company', subject: 'carlos', id: 'm-1', agent: 'cleaner', actions: ['purge'],
    limits: { measures: [{ name: 'rows', max: 100, unit: 'rows' }] }, notBefore: nowS - 60, expiresAt: nowS + 3600, ...over,
});
const verifier = (c: string, extra = {}) => jwtMandateVerifier({ trustedIssuers: { 'did:example:company': issuer.publicKey }, credentialFor: () => c, ...extra });
const reason = async (c: string, extra = {}) => { const r = await verifier(c, extra).verify(request); return r.ok ? 'OK' : r.reason; };
const handmade = (vct: string, mandate: unknown) => signJws(issuer.privateKey, { alg: 'EdDSA', typ: 'dc+sd-jwt' }, { iss: 'did:example:company', sub: 'carlos', jti: 'x', exp: nowS + 60, vct, mandate });

describe('the issuer: measures travel in the second profile', () => {
    it('issues the second profile by itself when there are measures, and the first when there are none', () => {
        const payloadOf = (c: string) => JSON.parse(Buffer.from(c.split('.')[1]!, 'base64url').toString('utf8')) as { vct: string };
        expect(payloadOf(credential()).vct).toBe(MANDATE_VCT_V2);
        expect(payloadOf(credential({ limits: { amount: { max: 10, currency: 'EUR' } } })).vct).toBe(MANDATE_VCT);
    });
    it('refuses to put measures in the first profile: a verifier that does not know them would drop them', () => {
        expect(() => credential({ vct: MANDATE_VCT })).toThrow(/measures need the profile/);
    });
});

describe('the verifier reads the measures of the second profile', () => {
    it('gives them in the mandate, next to the amount', async () => {
        const r = await verifier(credential({ limits: { amount: { max: 10, currency: 'EUR' }, measures: [{ name: 'rows', max: 100, unit: 'rows' }, { name: 'targets', max: 2 }] } })).verify(request);
        expect(r).toMatchObject({ ok: true, mandate: { limits: { amount: { max: 10, currency: 'EUR' }, measures: [{ name: 'rows', max: 100, unit: 'rows' }, { name: 'targets', max: 2 }] } } });
    });

    it('a credential of the second profile with no measures is fine', async () => {
        expect(await reason(credential({ vct: MANDATE_VCT_V2, limits: { amount: { max: 10, currency: 'EUR' } } }))).toBe('OK');
    });

    it('measures in the first profile are refused, not dropped, and the reason says which profile they need', async () => {
        expect(await reason(handmade(MANDATE_VCT, { actions: ['purge'], limits: { measures: [{ name: 'rows', max: 5 }] } }))).toMatch(/measures need "urn:backendkit:mandate:2"/);
    });

    it('a verifier that only knows the first profile refuses a credential of the second: it cannot accept it and drop the caps', async () => {
        expect(await reason(credential(), { vct: MANDATE_VCT })).toMatch(/is not a "urn:backendkit:mandate:1" credential/);
    });

    it('refuses what it does not understand: a key of a measure, a bad or repeated name, a bad maximum or unit, an empty or malformed list', async () => {
        const bad = (measures: unknown) => reason(handmade(MANDATE_VCT_V2, { actions: ['purge'], limits: { measures } }));
        expect(await bad([{ name: 'rows', max: 5, per: 'day' }])).toMatch(/restriction this verifier cannot enforce.*per/);
        expect(await bad([{ name: 'Rows', max: 5 }])).toMatch(/no valid name/);
        expect(await bad([{ name: 'amount', max: 5 }])).toMatch(/no valid name/);
        expect(await bad([{ name: 'rows', max: 5 }, { name: 'rows', max: 9 }])).toMatch(/more than once/);
        expect(await bad([{ name: 'rows', max: -1 }])).toMatch(/not a valid number/);
        expect(await bad([{ name: 'rows', max: '5' }])).toMatch(/not a valid number/);
        expect(await bad([{ name: 'rows', max: 5, unit: '' }])).toMatch(/unit/);
        expect(await bad([])).toMatch(/at least one measure/);
        expect(await bad('rows')).toMatch(/at least one measure/);
        expect(await bad([null])).toMatch(/not an object/);
    });
});

describe('the adapter kit: a power may carry measures, and they are checked', () => {
    const one = (measures: unknown) => checkPowers([{ power: { action: 'purge', measures }, extraKeys: [] }]);
    it('accepts valid ones and refuses the rest with the action named', () => {
        expect(one([{ name: 'rows', max: 5 }])).toMatchObject({ ok: true });
        expect(one([{ name: 'rows', max: 5 }, { name: 'rows', max: 6 }])).toMatchObject({ ok: false, reason: expect.stringContaining('"purge": the measure "rows" appears more than once') });
        expect(one([{ name: 'rows', max: 'x' }])).toMatchObject({ ok: false });
    });
});

describe('with an engine: the cap is enforced and the audit says under which mandate', () => {
    const agent: AgentProfile = { id: 'cleaner', name: 'Cleaner', icon: 'c', description: 'x', systemPrompt: 'Clean.', allowedTools: ['purge'] };
    async function run(rowsToPurge: number) {
        const ran: unknown[] = [];
        const purge = { name: 'purge', description: 'purge', parameters: {}, destructive: true, execute: async (a: unknown) => { ran.push(a); return 'purged'; } } as ToolDefinition;
        const audit = new MemoryAuditSink();
        const calls = [{ tool_calls: [{ id: 'c', name: 'purge', args: { ids: Array.from({ length: rowsToPurge }, (_, i) => `r${i}`) } }] }, { content: 'done' }];
        let i = 0;
        const provider = { chat: async (_m: unknown, _t: unknown, cb: any) => {
            const turn = calls[Math.min(i++, calls.length - 1)] as any;
            if (turn.tool_calls) { for (const t of turn.tool_calls) cb.onToolCall?.(t.name, JSON.stringify(t.args), t.id); cb.onDone({ role: 'assistant', content: null, tool_calls: turn.tool_calls.map((t: any) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } })) }); }
            else { cb.onChunk?.(turn.content); cb.onDone({ role: 'assistant', content: turn.content }); }
        } };
        const engine = createBaseEngine({
            requireAgentIdentity: false, providers: { mock: provider as never }, defaultProvider: 'mock', agents: [agent], defaultAgent: 'cleaner', tools: [purge],
            transport: { emit: () => undefined } as never, workingDir: process.cwd(), iterationMode: 'auto', audit, identity: { userId: 'carlos' },
            policy: mandatePolicy({
                verifier: verifier(credential()),
                measureOf: { rows: (args) => ({ value: (args.ids as string[]).length, unit: 'rows' }) },
            }),
        } as never);
        await engine.run('clean');
        return { ran, event: audit.events.find(e => e.tool === 'purge')! };
    }

    it('a purge inside the cap runs under the mandate', async () => {
        const { ran, event } = await run(50);
        expect(ran).toHaveLength(1);
        expect(event).toMatchObject({ decision: 'allow', mandate: { id: 'm-1', subject: 'carlos' } });
    });
    it('a purge above it does not run (nobody is configured to approve), and the audit says why', async () => {
        const { ran, event } = await run(500);
        expect(ran).toHaveLength(0);
        expect(event.reason).toMatch(/outside the mandate.*the rows 500 is above the 100/);
    });
});
