/** The default verifier: what it accepts, and every way a credential can be wrong or forged. */
import { generateKeyPairSync, createHmac } from 'node:crypto';
import { createBaseEngine, mandatePolicy, MemoryAuditSink, type AgentProfile, type ToolDefinition } from '@backendkit-labs/agent-core';
import { jwtMandateVerifier, issueMandate, parseJws, signJws, MANDATE_VCT } from '../index';

const now = new Date('2026-11-22T12:00:00Z');
const nowS = Math.floor(now.getTime() / 1000);
const company = generateKeyPairSync('ed25519');
const bank = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const stranger = generateKeyPairSync('ed25519');

const request = { principal: { agentId: 'buyer', sessionId: 's', chain: ['buyer'], userId: 'carlos' }, call: { tool: { name: 'buy' } as never, args: {} } };

function credential(over: Record<string, unknown> = {}, key = company.privateKey, alg: 'EdDSA' | 'ES256' = 'EdDSA') {
    return issueMandate({
        privateKey: key, alg, issuer: 'did:example:company', subject: 'carlos', id: 'm-1', agent: 'buyer', actions: ['buy'],
        limits: { amount: { max: 1000, currency: 'EUR' } }, notBefore: nowS - 60, expiresAt: nowS + 3600, ...over,
    });
}
const verifier = (c: string | undefined, extra = {}) => jwtMandateVerifier({
    trustedIssuers: { 'did:example:company': company.publicKey, 'did:example:bank': bank.publicKey },
    credentialFor: () => c, now: () => now, ...extra,
});
const reason = async (c: string | undefined, extra = {}) => {
    const r = await verifier(c, extra).verify(request);
    return r.ok ? 'OK' : r.reason;
};

describe('a valid credential', () => {
    it('becomes a mandate with its fields, its dates and the credential as evidence', async () => {
        const c = credential();
        const r = await verifier(c).verify(request);
        expect(r).toMatchObject({ ok: true, mandate: {
            id: 'm-1', issuer: 'did:example:company', subject: 'carlos', agent: 'buyer', actions: ['buy'],
            limits: { amount: { max: 1000, currency: 'EUR' } }, evidence: c,
        } });
        if (r.ok) { expect(r.mandate.validUntil).toBe(new Date((nowS + 3600) * 1000).toISOString()); expect(r.mandate.validFrom).toBe(new Date((nowS - 60) * 1000).toISOString()); }
    });
    it('ES256 works too, and `jwt~` (an SD-JWT with no disclosures) is read as the jwt', async () => {
        expect(await reason(credential({ issuer: 'did:example:bank' }, bank.privateKey, 'ES256'))).toBe('OK');
        expect(await reason(`${credential()}~`)).toBe('OK');
    });
    it('key rotation: a list of keys for an issuer, any of them', async () => {
        const v = jwtMandateVerifier({ trustedIssuers: { 'did:example:company': [stranger.publicKey, company.publicKey] }, credentialFor: () => credential(), now: () => now });
        expect((await v.verify(request)).ok).toBe(true);
    });
});

describe('forged or wrong credentials are refused, each for its own reason', () => {
    it('no credential at all', async () => expect(await reason(undefined)).toMatch(/holds no mandate/));
    it('a credential that cannot be read from the source', async () => {
        const v = jwtMandateVerifier({ trustedIssuers: {}, credentialFor: () => { throw new Error('vault down'); } });
        expect(await v.verify(request)).toMatchObject({ ok: false, reason: expect.stringContaining('vault down') });
    });
    it('not a JWS, not base64url, not JSON', async () => {
        expect(await reason('hello')).toMatch(/malformed/);
        expect(await reason('a.b.c!')).toMatch(/malformed/);
        expect(await reason('e30.e30.e30')).toMatch(/no alg/);
    });
    it('signed by a key of someone else, with the right issuer name', async () => {
        expect(await reason(credential({}, stranger.privateKey))).toMatch(/signature does not verify/);
    });
    it('an issuer that is not trusted, even if the signature is perfect', async () => {
        expect(await reason(credential({ issuer: 'did:example:evil' }, stranger.privateKey))).toMatch(/not one you trust/);
    });
    it('a payload edited after signing', async () => {
        const [h, , s] = credential().split('.');
        const edited = Buffer.from(JSON.stringify({ iss: 'did:example:company', sub: 'carlos', jti: 'm-1', exp: nowS + 3600, vct: MANDATE_VCT, mandate: { actions: ['*'] } })).toString('base64url');
        expect(await reason(`${h}.${edited}.${s}`)).toMatch(/signature does not verify/);
    });
    it('alg "none" and HS256 with the public key as the secret are not accepted', async () => {
        const payload = Buffer.from(JSON.stringify({ iss: 'did:example:company', sub: 'carlos', jti: 'x', exp: nowS + 60, vct: MANDATE_VCT, mandate: { actions: ['*'] } })).toString('base64url');
        const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'dc+sd-jwt' })).toString('base64url')}.${payload}.`;
        expect(await reason(none)).toMatch(/not accepted/);
        const hsHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'dc+sd-jwt' })).toString('base64url');
        const pem = company.publicKey.export({ type: 'spki', format: 'pem' }).toString();
        const sig = createHmac('sha256', pem).update(`${hsHeader}.${payload}`).digest('base64url');
        expect(await reason(`${hsHeader}.${payload}.${sig}`)).toMatch(/not accepted/);
    });
    it('the algorithm and the key must go together (an ES256 token against an Ed25519 key)', async () => {
        const wrong = signJws(bank.privateKey, { alg: 'ES256', typ: 'dc+sd-jwt' }, { iss: 'did:example:company', sub: 'carlos', jti: 'x', exp: nowS + 60, vct: MANDATE_VCT, mandate: { actions: ['buy'] } });
        expect(await reason(wrong)).toMatch(/signature does not verify/);
    });
    it('a type, a vct or an expiry that the profile does not accept', async () => {
        expect(await reason(signJws(company.privateKey, { alg: 'EdDSA', typ: 'JWT' }, { iss: 'did:example:company' }))).toMatch(/type "JWT" is not accepted/);
        expect(await reason(credential({ vct: 'urn:other' }))).toMatch(/is not a/);
        expect(await reason(signJws(company.privateKey, { alg: 'EdDSA', typ: 'dc+sd-jwt' }, { iss: 'did:example:company', sub: 'carlos', jti: 'x', vct: MANDATE_VCT, mandate: { actions: ['buy'] } }))).toMatch(/no expiry/);
    });
    it('expired and not valid yet, with a leeway only when asked for', async () => {
        expect(await reason(credential({ expiresAt: nowS - 1 }))).toMatch(/expired/);
        expect(await reason(credential({ expiresAt: nowS - 1 }), { leewaySeconds: 5 })).toBe('OK');
        expect(await reason(credential({ notBefore: nowS + 600 }))).toMatch(/not valid yet/);
    });
    it('a mandate claim that is not well formed', async () => {
        const bad = (mandate: unknown) => signJws(company.privateKey, { alg: 'EdDSA', typ: 'dc+sd-jwt' }, { iss: 'did:example:company', sub: 'carlos', jti: 'x', exp: nowS + 60, vct: MANDATE_VCT, mandate });
        expect(await reason(bad(undefined))).toMatch(/no mandate claim/);
        expect(await reason(bad({ actions: [] }))).toMatch(/actions/);
        expect(await reason(bad({ actions: ['buy'], limits: { amount: { max: 'lots' } } }))).toMatch(/limits/);
        expect(await reason(bad({ actions: ['buy'], limits: { amount: { max: -1 } } }))).toMatch(/limits/);
    });
    it('selective disclosures and key binding are refused, not half read', async () => {
        expect(await reason(`${credential()}~WyJzYWx0IiwiYSIsMV0~`)).toMatch(/selective disclosures/);
    });
});

describe('revocation', () => {
    it('a revoked mandate is refused', async () => expect(await reason(credential(), { isRevoked: () => true })).toMatch(/revoked/));
    it('a hook that fails is treated as revoked: unknown is not "fine"', async () => {
        expect(await reason(credential(), { isRevoked: async () => { throw new Error('status list down'); } })).toMatch(/revoked, or its status could not be checked/);
    });
    it('the hook receives the mandate, so it can look it up by id', async () => {
        const seen: string[] = [];
        await reason(credential(), { isRevoked: (m: { id: string }) => { seen.push(m.id); return false; } });
        expect(seen).toEqual(['m-1']);
    });
});

describe('parseJws', () => {
    it('does not accept a token with extra parts', () => expect(parseJws('a.b.c.d')).toMatchObject({ ok: false }));
});

describe('with an engine: a signed mandate lets an agent buy alone, within its limit', () => {
    const agent: AgentProfile = { id: 'buyer', name: 'Buyer', icon: '🛒', description: 'x', systemPrompt: 'Buy.', allowedTools: ['buy'] };
    async function run(amount: number, c: string | undefined) {
        const bought: unknown[] = [];
        const buy = { name: 'buy', description: 'buy', parameters: {}, destructive: true, execute: async (a: unknown) => { bought.push(a); return 'bought'; } } as ToolDefinition;
        const audit = new MemoryAuditSink();
        const calls = [{ tool_calls: [{ id: 'c', name: 'buy', args: { amount, currency: 'EUR' } }] }, { content: 'done' }];
        let i = 0;
        const provider = { chat: async (_m: unknown, _t: unknown, cb: any) => {
            const turn = calls[Math.min(i++, calls.length - 1)] as any;
            if (turn.tool_calls) { for (const t of turn.tool_calls) cb.onToolCall?.(t.name, JSON.stringify(t.args), t.id); cb.onDone({ role: 'assistant', content: null, tool_calls: turn.tool_calls.map((t: any) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } })) }); }
            else { cb.onChunk?.(turn.content); cb.onDone({ role: 'assistant', content: turn.content }); }
        } };
        const engine = createBaseEngine({
            providers: { mock: provider as never }, defaultProvider: 'mock', agents: [agent], defaultAgent: 'buyer', tools: [buy],
            transport: { emit: () => undefined } as never, workingDir: process.cwd(), iterationMode: 'auto', audit, identity: { userId: 'carlos' },
            policy: mandatePolicy({
                verifier: jwtMandateVerifier({ trustedIssuers: { 'did:example:company': company.publicKey }, credentialFor: () => c, now: () => new Date() }),
                amountOf: a => ({ value: Number(a.amount), currency: String(a.currency) }),
            }),
        } as never);
        await engine.run('buy a tv');
        return { bought, audit };
    }
    const live = () => credential({ notBefore: Math.floor(Date.now() / 1000) - 60, expiresAt: Math.floor(Date.now() / 1000) + 3600 });

    it('600 EUR with a mandate of 1000: it buys, nobody is asked, and the audit says under which mandate', async () => {
        const { bought, audit } = await run(600, live());
        expect(bought).toHaveLength(1);
        const ev = audit.events.find(e => e.tool === 'buy')!;
        expect(ev.mandate).toMatchObject({ id: 'm-1', issuer: 'did:example:company', subject: 'carlos' });
        expect(ev.mandate!.evidenceHash).toMatch(/^[0-9a-f]{64}$/);
    });
    it('1500 EUR: above the mandate, it does not buy', async () => expect((await run(1500, live())).bought).toHaveLength(0));
    it('without a credential it does not buy', async () => expect((await run(10, undefined)).bought).toHaveLength(0));
    it('with a credential signed by a stranger it does not buy', async () => expect((await run(10, credential({}, stranger.privateKey))).bought).toHaveLength(0));
});
