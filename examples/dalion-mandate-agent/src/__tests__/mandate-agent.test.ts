/**
 * The purchasing agent under a mandate, end to end: the real engine, the real policy and the real verifier of `agent-mandates`; only
 * the model (a script) and DALION (a stand-in issuing an ASSUMED format) are simulated.
 *
 * The credential speaks the language of the domain: FOR WHOM the agent works, WHAT it may do (buy), ON WHAT (a television) and up to
 * HOW MUCH (1000 EUR). It never names a tool: which tool of the agent performs "buy" is the operator's configuration.
 *
 * What is proved: inside the mandate the agent acts alone and the audit names the mandate; outside it, a person decides; with no valid
 * mandate, nothing happens and nobody is even asked; and every way a credential can be wrong, forged, stale, revoked or for somebody
 * else is refused. These tests are also the contract a REAL DALION adapter has to keep passing.
 */
import { createHmac, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCheckpoints, verifyAuditChain, type Approver } from '@backendkit-labs/agent-core';
import { scriptedProvider, mockTransport } from '@backendkit-labs/agent-testkit';
import { signJws } from '@backendkit-labs/agent-mandates';
import { AGENT_DALION_IDENTITY, buildBuyerAgent } from '../agent';
import { DalionSim } from '../dalion-sim';
import { DALION_ASSUMED_VCT, type DalionPower } from '../dalion-assumed';

const nowS = () => Math.floor(Date.now() / 1000);
const buyCall = (amount: number, item = 'television', currency = 'EUR', id = 'c1') => ({ tool_calls: [{ id, name: 'buy_supplies', args: { item, amount, currency } }] });
const TV_1000: DalionPower = { action: 'buy', object: 'television', max: { value: 1000, currency: 'EUR' } };

describe('a purchasing agent under a mandate: buy a television, at most 1000 EUR', () => {
    let dir: string;
    let dalion: DalionSim;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mandate-agent-')); dalion = new DalionSim(); });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const human = (decision: 'approve' | 'reject'): Approver => ({
        ref: { kind: 'human', id: 'finance-lead' },
        request: async () => ({ decision, by: { kind: 'human', id: 'finance-lead' }, reason: `test: ${decision}`, at: new Date().toISOString() }),
    });

    function setup(credential: () => string | undefined, extra: Partial<Parameters<typeof buildBuyerAgent>[0]> = {}, script: unknown[] = [buyCall(800), { content: 'done' }]) {
        return buildBuyerAgent({
            provider: scriptedProvider(script as never), transport: mockTransport().transport, userId: 'carlos',
            credential, trustedIssuers: { [dalion.issuer]: dalion.publicKey }, isRevoked: dalion.isRevoked,
            auditLogPath: join(dir, 'audit.ndjson'), checkpointsPath: join(dir, 'checkpoints.ndjson'), ...extra,
        });
    }
    const power = (over: Record<string, unknown> = {}) => dalion.issue({
        agent: AGENT_DALION_IDENTITY, represents: 'carlos', expiresAt: nowS() + 3600, powers: [TV_1000], ...over,
    });
    const auditEntries = () => readFileSync(join(dir, 'audit.ndjson'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, any>);
    const eventOf = (tool: string) => auditEntries().map(e => e.event ?? e).find(e => e.tool === tool);

    describe('inside its mandate', () => {
        it('buys a 800 EUR television alone, asks nobody, and the audit says under which mandate', async () => {
            const cred = power({ id: 'cred-42' });
            const a = setup(() => cred);
            const out = await a.engine.run('buy a television');
            expect(out.errors).toEqual([]);
            expect(a.purchases).toEqual([{ item: 'television', amount: 800, currency: 'EUR' }]);
            expect(a.approvals).toHaveLength(0);
            const ev = eventOf('buy_supplies');
            expect(ev.decision).toBe('allow');
            expect(ev.mandate).toMatchObject({ id: 'cred-42', issuer: dalion.issuer, subject: 'carlos' });
            expect(ev.mandate.evidenceHash).toMatch(/^[0-9a-f]{64}$/);
            expect(JSON.stringify(auditEntries())).not.toContain(cred); // the credential itself never reaches the log
        });

        it('exactly 1000 EUR is inside the limit', async () => {
            const a = setup(() => power(), {}, [buyCall(1000), { content: 'ok' }]);
            await a.engine.run('buy');
            expect(a.purchases).toHaveLength(1);
            expect(a.approvals).toHaveLength(0);
        });

        it('the credential never names a tool: it holds a verb and an object', () => {
            const [, body] = power().split('.');
            const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
            expect(payload.powers).toEqual([TV_1000]);
            expect(JSON.stringify(payload)).not.toMatch(/buy_supplies|sign_contract|check_price/);
        });

        it('looking a price up needs no mandate: it changes nothing', async () => {
            const a = setup(() => undefined, {}, [{ tool_calls: [{ id: 'p', name: 'check_price', args: { item: 'television' } }] }, { content: '120 EUR' }]);
            const out = await a.engine.run('how much is a television?');
            expect(out.toolCalls.map(c => `${c.name}:${c.success}`)).toEqual(['check_price:true']);
        });

        it('the audit chain verifies and its head is signed', async () => {
            const a = setup(() => power());
            await a.engine.run('buy a television');
            expect(verifyAuditChain(join(dir, 'audit.ndjson')).ok).toBe(true);
            const cps = readCheckpoints(join(dir, 'checkpoints.ndjson'));
            expect(cps.length).toBeGreaterThan(0);
            expect(cps[cps.length - 1]).toMatchObject({ kid: 'audit-key-1' });
        });

        it('editing the audit afterwards is detected', async () => {
            const a = setup(() => power());
            await a.engine.run('buy a television');
            const file = join(dir, 'audit.ndjson');
            writeFileSync(file, readFileSync(file, 'utf8').replace('"decision":"allow"', '"decision":"deny"'));
            expect(verifyAuditChain(file).ok).toBe(false);
        });
    });

    describe('outside its mandate, a person decides', () => {
        it('1200 EUR for the television: asks; approved, it buys', async () => {
            const a = setup(() => power(), { approver: human('approve') }, [buyCall(1200), { content: 'done' }]);
            await a.engine.run('buy a television');
            expect(a.approvals).toHaveLength(1);
            expect(a.purchases).toEqual([{ item: 'television', amount: 1200, currency: 'EUR' }]);
        });

        it('1200 EUR for the television: asks; rejected, it does not buy', async () => {
            const a = setup(() => power(), { approver: human('reject') }, [buyCall(1200), { content: 'refused' }]);
            await a.engine.run('buy a television');
            expect(a.approvals).toHaveLength(1);
            expect(a.purchases).toHaveLength(0);
        });

        it('with no approver at all, outside the mandate nothing is bought', async () => {
            const a = setup(() => power(), {}, [buyCall(1200), { content: 'refused' }]);
            await a.engine.run('buy');
            expect(a.purchases).toHaveLength(0);
        });

        it('another object than the one empowered: a laptop is not a television', async () => {
            const a = setup(() => power(), { approver: human('reject') }, [buyCall(300, 'laptop'), { content: 'x' }]);
            await a.engine.run('buy a laptop');
            expect(a.approvals).toHaveLength(1);
            expect(a.approvals[0].reason).toMatch(/does not cover "laptop"/);
            expect(a.purchases).toHaveLength(0);
        });

        it('a call that does not say what it buys is not covered by a power that names an object', async () => {
            const a = setup(() => power(), { approver: human('reject') }, [buyCall(10, ''), { content: 'x' }]);
            await a.engine.run('buy something');
            expect(a.approvals).toHaveLength(1);
            expect(a.purchases).toHaveLength(0);
        });

        it('another verb than the one empowered: the credential lets it BUY, not SIGN', async () => {
            const a = setup(() => power(), { approver: human('reject') }, [{ tool_calls: [{ id: 's1', name: 'sign_contract', args: { contract: 'lease' } }] }, { content: 'x' }]);
            await a.engine.run('sign the lease');
            expect(a.approvals).toHaveLength(1);
            expect(a.contracts).toHaveLength(0);
        });

        it('a tool that declares no verb is never covered', async () => {
            const a = setup(() => power(), { approver: human('reject'), buyVerb: null }, [buyCall(10), { content: 'x' }]);
            await a.engine.run('buy');
            expect(a.approvals).toHaveLength(1);
            expect(a.purchases).toHaveLength(0);
        });

        it('another currency than the mandate\'s asks', async () => {
            const a = setup(() => power(), { approver: human('reject') }, [buyCall(10, 'television', 'USD'), { content: 'x' }]);
            await a.engine.run('buy');
            expect(a.approvals).toHaveLength(1);
            expect(a.purchases).toHaveLength(0);
        });

        it('a negative amount is not covered', async () => {
            const a = setup(() => power(), { approver: human('reject') }, [buyCall(-50), { content: 'x' }]);
            await a.engine.run('buy');
            expect(a.approvals).toHaveLength(1);
            expect(a.purchases).toHaveLength(0);
        });

        it('a mandate for another person than the one the agent acts for is not a permission', async () => {
            const a = setup(() => power({ represents: 'ana' }), { approver: human('reject') });
            await a.engine.run('buy');
            expect(a.approvals).toHaveLength(1);
            expect(a.purchases).toHaveLength(0);
        });
    });

    describe('several powers in one credential', () => {
        const multi = () => power({ powers: [
            TV_1000,
            { action: 'buy', object: 'laptop', max: { value: 2500, currency: 'EUR' } },
            { action: 'buy', max: { value: 300, currency: 'EUR' } },      // anything else, up to 300
        ] });

        it('each object has its own limit', async () => {
            const a = setup(multi, { approver: human('reject') }, [buyCall(2000, 'laptop', 'EUR', 'c1'), buyCall(1200, 'television', 'EUR', 'c2'), { content: 'x' }]);
            await a.engine.run('buy');
            expect(a.purchases).toEqual([{ item: 'laptop', amount: 2000, currency: 'EUR' }]); // the laptop within 2500; the television above 1000 asked and was rejected
            expect(a.approvals).toHaveLength(1);
        });

        it('a power with no object covers any other object, with its own limit; the specific one wins over it', async () => {
            const a = setup(multi, { approver: human('reject') }, [buyCall(200, 'chair', 'EUR', 'c1'), buyCall(400, 'chair', 'EUR', 'c2'), buyCall(900, 'television', 'EUR', 'c3'), { content: 'x' }]);
            await a.engine.run('buy');
            expect(a.purchases.map(p => `${p.item}:${p.amount}`)).toEqual(['chair:200', 'television:900']);
            expect(a.approvals).toHaveLength(1); // only the chair of 400
        });
    });

    describe('the credential and the agent are decoupled', () => {
        it('a credential that names a TOOL grants nothing: powers are verbs of the domain, declared by the tool', async () => {
            const byToolName = power({ powers: [{ action: 'buy_supplies', object: 'television', max: { value: 1000, currency: 'EUR' } }] });
            const a = setup(() => byToolName, { approver: human('reject') });
            await a.engine.run('buy');
            expect(a.purchases).toHaveLength(0);
            expect(a.approvals).toHaveLength(1);
            // not even when the tool declares no verb at all
            const b = setup(() => byToolName, { approver: human('reject'), buyVerb: null });
            await b.engine.run('buy');
            expect(b.purchases).toHaveLength(0);
        });

        it('the tool declares the verb it performs: another vocabulary, same agent, no change to the credential\'s shape', async () => {
            const cred = power({ powers: [{ action: 'purchase', object: 'television', max: { value: 1000, currency: 'EUR' } }] });
            const withDefault = setup(() => cred, { approver: human('reject') });
            await withDefault.engine.run('buy');
            expect(withDefault.purchases).toHaveLength(0);                // "buy" is not "purchase": asked, rejected
            const mapped = setup(() => cred, { buyVerb: 'purchase' });
            await mapped.engine.run('buy');
            expect(mapped.purchases).toHaveLength(1);                     // buy_supplies now declares that it performs "purchase"
        });
    });

    describe('with no valid mandate: denied for the RIGHT reason, and nobody is asked', () => {
        /** Runs one purchase under this credential and checks it was refused by the policy, for the reason expected, with no approver consulted. */
        const denied = async (credential: () => string | undefined, why: RegExp, extra: Partial<Parameters<typeof buildBuyerAgent>[0]> = {}) => {
            const a = setup(credential, { approver: human('approve'), ...extra });
            await a.engine.run('buy a television');
            expect(a.purchases).toHaveLength(0);       // not even an approver that would say yes gets to decide
            expect(a.approvals).toHaveLength(0);
            const ev = eventOf('buy_supplies');
            expect(ev).toBeDefined();                  // it reached the policy: it was not refused by something else
            expect(ev.decision).toBe('deny');
            expect(ev.reason).toMatch(why);
        };

        it('no credential', async () => { await denied(() => undefined, /holds no power/); });
        it('a credential signed by somebody else', async () => {
            const forged = dalion.issue({ agent: AGENT_DALION_IDENTITY, represents: 'carlos', expiresAt: nowS() + 3600, powers: [TV_1000] }, generateKeyPairSync('ed25519').privateKey);
            await denied(() => forged, /signature does not verify/);
        });
        it('an issuer that is not trusted', async () => { await denied(() => power(), /is not one you trust/, { trustedIssuers: { 'did:dalion:issuer:other': dalion.publicKey } }); });
        it('an expired credential', async () => { await denied(() => power({ notBefore: nowS() - 7200, expiresAt: nowS() - 3600 }), /has expired/); });
        it('a credential that is not valid yet', async () => { await denied(() => power({ notBefore: nowS() + 3600, expiresAt: nowS() + 7200 }), /not valid yet/); });
        it('a credential with no expiry', async () => { await denied(() => power({ payload: { exp: undefined } }), /no expiry/); });
        it('a credential issued to another agent identity', async () => { await denied(() => power({ agent: 'did:dalion:agent:somebody-else' }), /another agent identity/); });
        it('a credential that grants no powers', async () => { await denied(() => power({ powers: [] }), /grants no powers/); });
        it('a wildcard action', async () => { await denied(() => power({ powers: [{ action: '*', max: { value: 1_000_000, currency: 'EUR' } }] }), /wildcard/); });
        it('a wildcard object', async () => { await denied(() => power({ powers: [{ action: 'buy', object: '*', max: { value: 1_000_000, currency: 'EUR' } }] }), /wildcard object/); });
        it('the same verb and object twice (an ambiguous limit)', async () => {
            await denied(() => power({ powers: [TV_1000, { action: 'buy', object: 'television', max: { value: 9999, currency: 'EUR' } }] }), /more than once/);
        });
        it('a limit with no currency', async () => { await denied(() => power({ powers: [{ action: 'buy', object: 'television', max: { value: 1000 } }] }), /no currency/); });
        it('a limit that is not a number', async () => { await denied(() => power({ powers: [{ action: 'buy', object: 'television', max: { value: 'lots', currency: 'EUR' } }] }), /limit of "buy" is not valid/); });
        it('an object that is not a string', async () => { await denied(() => power({ powers: [{ action: 'buy', object: 42, max: { value: 1000, currency: 'EUR' } }] }), /object of "buy" is not valid/); });
        it('a credential that does not say for whom the agent works', async () => { await denied(() => power({ payload: { represents: {} } }), /does not say who the agent works for/); });
        it('a credential that is not the assumed type', async () => { await denied(() => power({ payload: { vct: 'urn:something:else' } }), /is not a ".*" credential/); });
        it('a credential with selective disclosures, which are not supported', async () => { await denied(() => `${power()}~WyJzYWx0Il0~`, /selective disclosures/); });
        it('garbage', async () => { await denied(() => 'not-a-jwt', /malformed/); });

        it('a credential whose payload was edited after signing (the limit raised)', async () => {
            const [h, p, s] = power().split('.');
            const body = JSON.parse(Buffer.from(p, 'base64url').toString());
            body.powers[0].max.value = 99_999;
            await denied(() => `${h}.${Buffer.from(JSON.stringify(body)).toString('base64url')}.${s}`, /signature does not verify/);
        });

        it('alg "none"', async () => {
            const [, p] = power().split('.');
            const h = Buffer.from(JSON.stringify({ alg: 'none', typ: 'dc+sd-jwt' })).toString('base64url');
            await denied(() => `${h}.${p}.`, /algorithm "none" is not accepted/);
        });

        it('an HMAC token signed with the issuer\'s PUBLIC key as the secret (algorithm confusion)', async () => {
            const pem = dalion.publicKey.export({ type: 'spki', format: 'pem' }).toString();
            const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'dc+sd-jwt' })).toString('base64url');
            const p = Buffer.from(JSON.stringify({
                iss: dalion.issuer, sub: AGENT_DALION_IDENTITY, jti: 'x', exp: nowS() + 3600, vct: DALION_ASSUMED_VCT,
                represents: { id: 'carlos' }, powers: [TV_1000],
            })).toString('base64url');
            const sig = createHmac('sha256', pem).update(`${h}.${p}`).digest('base64url');
            await denied(() => `${h}.${p}.${sig}`, /algorithm "HS256" is not accepted/);
        });

        it('a credential source that throws', async () => { await denied(() => { throw new Error('vault is down'); }, /could not be read: vault is down/); });
        it('a revocation check that cannot answer counts as revoked', async () => {
            await denied(() => power(), /revoked, or its status could not be checked/, { isRevoked: () => { throw new Error('status service down'); } });
        });
        it('a credential revoked at the issuer', async () => {
            const cred = power({ id: 'cred-gone' });
            dalion.revoke('cred-gone');
            await denied(() => cred, /revoked/);
        });
    });

    describe('revocation', () => {
        it('a mandate revoked between two purchases stops the second one', async () => {
            const cred = power({ id: 'cred-rev' });
            const a = setup(() => cred, {}, [buyCall(100, 'television', 'EUR', 'c1'), buyCall(100, 'television', 'EUR', 'c2'), { content: 'done' }]);
            let revoked = false;
            const original = a.purchases.push.bind(a.purchases);
            a.purchases.push = (...items) => { const n = original(...items); if (!revoked) { revoked = true; dalion.revoke('cred-rev'); } return n; };
            await a.engine.run('buy twice');
            expect(a.purchases).toHaveLength(1);
        });
    });

    describe('what the mandate does not do (documented, so nobody assumes it does)', () => {
        it('the limit is per operation, not cumulative: two purchases of 600 each both pass under a 1000 mandate', async () => {
            const a = setup(() => power(), {}, [buyCall(600, 'television', 'EUR', 'c1'), buyCall(600, 'television', 'EUR', 'c2'), { content: 'done' }]);
            await a.engine.run('buy twice');
            // This is the current, intended behaviour of the reference verifier (SPEC-0043 §6, open question 2). If the real credential
            // means a TOTAL, the adapter must keep what was spent and this test must change with it.
            expect(a.purchases).toHaveLength(2);
        });

        it('the object is matched by exact text: the model saying "TV" is not "television" and asks (safe, but annoying)', async () => {
            const a = setup(() => power(), { approver: human('reject') }, [buyCall(500, 'TV'), { content: 'x' }]);
            await a.engine.run('buy a TV');
            expect(a.approvals).toHaveLength(1);
            expect(a.purchases).toHaveLength(0);
        });
    });

    it('a mandate forged in the token body does not help without the issuer\'s key', async () => {
        const stranger = generateKeyPairSync('ed25519');
        const forged = signJws(stranger.privateKey, { alg: 'EdDSA', typ: 'dc+sd-jwt' }, {
            iss: dalion.issuer, sub: AGENT_DALION_IDENTITY, jti: 'forged', exp: nowS() + 3600, vct: DALION_ASSUMED_VCT,
            represents: { id: 'carlos' }, powers: [{ action: 'buy', max: { value: 1_000_000, currency: 'EUR' } }],
        });
        const a = setup(() => forged, { approver: human('approve') });
        await a.engine.run('buy');
        expect(a.purchases).toHaveLength(0);
    });
});
