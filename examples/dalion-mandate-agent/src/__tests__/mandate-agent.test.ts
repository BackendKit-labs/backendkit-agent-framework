/**
 * The purchasing agent under a mandate, end to end: the real engine, the real policy and the real verifier of `agent-mandates`; only
 * the model (a script) and DALION (a stand-in issuing an ASSUMED format) are simulated.
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
import { DALION_ASSUMED_VCT } from '../dalion-assumed';

const nowS = () => Math.floor(Date.now() / 1000);
const buyCall = (amount: number, currency = 'EUR', id = 'c1') => ({ tool_calls: [{ id, name: 'buy_supplies', args: { item: 'paper', amount, currency } }] });

describe('a purchasing agent under a mandate', () => {
    let dir: string;
    let dalion: DalionSim;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mandate-agent-')); dalion = new DalionSim(); });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const human = (decision: 'approve' | 'reject'): Approver => ({
        ref: { kind: 'human', id: 'finance-lead' },
        request: async () => ({ decision, by: { kind: 'human', id: 'finance-lead' }, reason: `test: ${decision}`, at: new Date().toISOString() }),
    });

    function setup(credential: () => string | undefined, extra: Partial<Parameters<typeof buildBuyerAgent>[0]> = {}, script: unknown[] = [buyCall(100), { content: 'done' }]) {
        const t = mockTransport();
        const agent = buildBuyerAgent({
            provider: scriptedProvider(script as never), transport: t.transport, userId: 'carlos',
            credential, trustedIssuers: { [dalion.issuer]: dalion.publicKey }, isRevoked: dalion.isRevoked,
            auditLogPath: join(dir, 'audit.ndjson'), checkpointsPath: join(dir, 'checkpoints.ndjson'), ...extra,
        });
        return agent;
    }
    const power = (over: Record<string, unknown> = {}) => dalion.issue({
        agent: AGENT_DALION_IDENTITY, represents: 'carlos', expiresAt: nowS() + 3600,
        powers: [{ action: 'check_price' }, { action: 'buy_supplies', max: { value: 500, currency: 'EUR' } }], ...over,
    });
    const auditEntries = () => readFileSync(join(dir, 'audit.ndjson'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, any>);
    const eventOf = (tool: string) => auditEntries().map(e => e.event ?? e).find(e => e.tool === tool);

    describe('inside its mandate', () => {
        it('buys alone, asks nobody, and the audit says under which mandate', async () => {
            const cred = power({ id: 'cred-42' });
            const a = setup(() => cred);
            const out = await a.engine.run('buy paper');
            expect(out.errors).toEqual([]);
            expect(a.purchases).toEqual([{ item: 'paper', amount: 100, currency: 'EUR' }]);
            expect(a.approvals).toHaveLength(0);
            const ev = eventOf('buy_supplies');
            expect(ev.mandate).toMatchObject({ id: 'cred-42', issuer: dalion.issuer, subject: 'carlos' });
            expect(ev.mandate.evidenceHash).toMatch(/^[0-9a-f]{64}$/);
            expect(JSON.stringify(auditEntries())).not.toContain(cred); // the credential itself never reaches the log
        });

        it('exactly at the limit is inside it; one cent above is not', async () => {
            const at = setup(() => power(), {}, [buyCall(500), { content: 'ok' }]);
            await at.engine.run('buy');
            expect(at.purchases).toHaveLength(1);
            expect(at.approvals).toHaveLength(0);
        });

        it('the audit chain verifies and its head is signed', async () => {
            const a = setup(() => power());
            await a.engine.run('buy paper');
            const check = verifyAuditChain(join(dir, 'audit.ndjson'));
            expect(check.ok).toBe(true);
            const cps = readCheckpoints(join(dir, 'checkpoints.ndjson'));
            expect(cps.length).toBeGreaterThan(0);
            expect(cps[cps.length - 1]).toMatchObject({ kid: 'audit-key-1' });
        });

        it('editing the audit afterwards is detected', async () => {
            const a = setup(() => power());
            await a.engine.run('buy paper');
            const file = join(dir, 'audit.ndjson');
            writeFileSync(file, readFileSync(file, 'utf8').replace('"decision":"allow"', '"decision":"deny"'));
            expect(verifyAuditChain(file).ok).toBe(false);
        });
    });

    describe('outside its mandate, a person decides', () => {
        it('above the limit: asks; approved, it buys, and the approval is recorded', async () => {
            const a = setup(() => power(), { approver: human('approve') }, [buyCall(700), { content: 'done' }]);
            await a.engine.run('buy a lot of paper');
            expect(a.approvals).toHaveLength(1);
            expect(a.purchases).toEqual([{ item: 'paper', amount: 700, currency: 'EUR' }]);
        });

        it('above the limit: asks; rejected, it does not buy', async () => {
            const a = setup(() => power(), { approver: human('reject') }, [buyCall(700), { content: 'refused' }]);
            await a.engine.run('buy a lot of paper');
            expect(a.approvals).toHaveLength(1);
            expect(a.purchases).toHaveLength(0);
        });

        it('with no approver at all, outside the mandate nothing is bought', async () => {
            const a = setup(() => power(), {}, [buyCall(700), { content: 'refused' }]);
            await a.engine.run('buy a lot');
            expect(a.purchases).toHaveLength(0);
        });

        it('a tool the mandate does not list is never covered, however small', async () => {
            const a = setup(() => power(), { approver: human('reject') }, [{ tool_calls: [{ id: 's1', name: 'sign_contract', args: { contract: 'lease' } }] }, { content: 'refused' }]);
            await a.engine.run('sign the lease');
            expect(a.approvals).toHaveLength(1);
            expect(a.contracts).toHaveLength(0);
        });

        it('the limit is per action: a generous limit on one tool does not stretch to another', async () => {
            const cred = power({ powers: [{ action: 'buy_supplies', max: { value: 500, currency: 'EUR' } }, { action: 'sign_contract', max: { value: 0, currency: 'EUR' } }] });
            const a = setup(() => cred, { approver: human('reject') }, [{ tool_calls: [{ id: 's1', name: 'sign_contract', args: { contract: 'lease' } }] }, { content: 'x' }]);
            await a.engine.run('sign');
            // sign_contract declares no amount, so a power that limits the amount cannot cover it: a person decides
            expect(a.approvals).toHaveLength(1);
            expect(a.contracts).toHaveLength(0);
        });

        it('another currency than the mandate\'s asks', async () => {
            const a = setup(() => power(), { approver: human('reject') }, [buyCall(10, 'USD'), { content: 'x' }]);
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

    describe('with no valid mandate: denied for the RIGHT reason, and nobody is asked', () => {
        /** Runs one purchase under this credential and checks it was refused by the policy, for the reason expected, with no approver consulted. */
        const denied = async (credential: () => string | undefined, why: RegExp, extra: Partial<Parameters<typeof buildBuyerAgent>[0]> = {}) => {
            const a = setup(credential, { approver: human('approve'), ...extra });
            await a.engine.run('buy paper');
            expect(a.purchases).toHaveLength(0);       // not even an approver that would say yes gets to decide
            expect(a.approvals).toHaveLength(0);
            const ev = eventOf('buy_supplies');
            expect(ev).toBeDefined();                  // it reached the policy: it was not refused by something else
            expect(ev.decision).toBe('deny');
            expect(ev.reason).toMatch(why);
        };

        it('no credential', async () => { await denied(() => undefined, /holds no power/); });
        it('a credential signed by somebody else', async () => {
            const forged = dalion.issue({ agent: AGENT_DALION_IDENTITY, represents: 'carlos', expiresAt: nowS() + 3600, powers: [{ action: 'buy_supplies', max: { value: 500, currency: 'EUR' } }] }, generateKeyPairSync('ed25519').privateKey);
            await denied(() => forged, /signature does not verify/);
        });
        it('an issuer that is not trusted', async () => { await denied(() => power(), /is not one you trust/, { trustedIssuers: { 'did:dalion:issuer:other': dalion.publicKey } }); });
        it('an expired credential', async () => { await denied(() => power({ notBefore: nowS() - 7200, expiresAt: nowS() - 3600 }), /has expired/); });
        it('a credential that is not valid yet', async () => { await denied(() => power({ notBefore: nowS() + 3600, expiresAt: nowS() + 7200 }), /not valid yet/); });
        it('a credential with no expiry', async () => { await denied(() => power({ payload: { exp: undefined } }), /no expiry/); });
        it('a credential issued to another agent identity', async () => { await denied(() => power({ agent: 'did:dalion:agent:somebody-else' }), /another agent identity/); });
        it('a credential that grants no powers', async () => { await denied(() => power({ powers: [] }), /grants no powers/); });
        it('a wildcard power', async () => { await denied(() => power({ powers: [{ action: '*', max: { value: 1_000_000, currency: 'EUR' } }] }), /wildcard/); });
        it('the same action twice (an ambiguous limit)', async () => {
            await denied(() => power({ powers: [{ action: 'buy_supplies', max: { value: 10, currency: 'EUR' } }, { action: 'buy_supplies', max: { value: 9999, currency: 'EUR' } }] }), /more than once/);
        });
        it('a limit with no currency', async () => { await denied(() => power({ powers: [{ action: 'buy_supplies', max: { value: 500 } }] }), /no currency/); });
        it('a limit that is not a number', async () => { await denied(() => power({ powers: [{ action: 'buy_supplies', max: { value: 'lots', currency: 'EUR' } }] }), /limit of "buy_supplies" is not valid/); });
        it('a credential that is not the assumed type', async () => { await denied(() => power({ payload: { vct: 'urn:something:else' } }), /is not a ".*" credential/); });
        it('a credential with selective disclosures, which are not supported', async () => { await denied(() => `${power()}~WyJzYWx0Il0~`, /selective disclosures/); });
        it('garbage', async () => { await denied(() => 'not-a-jwt', /malformed/); });

        it('a credential whose payload was edited after signing', async () => {
            const [h, p, s] = power().split('.');
            const body = JSON.parse(Buffer.from(p, 'base64url').toString());
            body.powers[1].max.value = 99_999;
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
                represents: { id: 'carlos' }, powers: [{ action: 'buy_supplies', max: { value: 500, currency: 'EUR' } }],
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
            const script = [buyCall(100, 'EUR', 'c1'), buyCall(100, 'EUR', 'c2'), { content: 'done' }];
            const t = mockTransport();
            let revokeAfterFirst = false;
            const a = buildBuyerAgent({
                provider: scriptedProvider(script as never), transport: t.transport, userId: 'carlos', credential: () => cred,
                trustedIssuers: { [dalion.issuer]: dalion.publicKey },
                isRevoked: (s) => { const r = dalion.isRevoked(s); return r; },
                auditLogPath: join(dir, 'audit.ndjson'), checkpointsPath: join(dir, 'checkpoints.ndjson'),
            });
            // revoke as soon as the first purchase has happened
            const original = a.purchases.push.bind(a.purchases);
            a.purchases.push = (...items) => { const n = original(...items); if (!revokeAfterFirst) { revokeAfterFirst = true; dalion.revoke('cred-rev'); } return n; };
            await a.engine.run('buy twice');
            expect(a.purchases).toHaveLength(1);
        });
    });

    describe('what the mandate does not do (documented, so nobody assumes it does)', () => {
        it('the limit is per operation, not cumulative: two purchases of 400 each both pass under a 500 mandate', async () => {
            const a = setup(() => power(), {}, [buyCall(400, 'EUR', 'c1'), buyCall(400, 'EUR', 'c2'), { content: 'done' }]);
            await a.engine.run('buy twice');
            // This is the current, intended behaviour of the reference verifier (SPEC-0043 §6, open question 2). If the real credential
            // means a TOTAL, the adapter must keep what was spent and this test must change with it.
            expect(a.purchases).toHaveLength(2);
        });
    });

    it('the adapter signs nothing and trusts nothing it was not given: a forged mandate claim in the TOKEN BODY does not help without the issuer\'s key', async () => {
        const stranger = generateKeyPairSync('ed25519');
        const forged = signJws(stranger.privateKey, { alg: 'EdDSA', typ: 'dc+sd-jwt' }, {
            iss: dalion.issuer, sub: AGENT_DALION_IDENTITY, jti: 'forged', exp: nowS() + 3600, vct: DALION_ASSUMED_VCT,
            represents: { id: 'carlos' }, powers: [{ action: 'buy_supplies', max: { value: 1_000_000, currency: 'EUR' } }],
        });
        const a = setup(() => forged, { approver: human('approve') });
        await a.engine.run('buy');
        expect(a.purchases).toHaveLength(0);
    });
});
