/**
 * FOR WHOM the agent works: the human the credential represents (SPEC-0043 / SPEC-0044).
 *
 * The human is not a string the application declares and the credential repeats. Here they are an identifier of the identity provider, mapped
 * from the application's own user id, structured (a person or a legal entity, with an assurance level), and they CONSENT: the person's own
 * signature covers what the agent may do for them, so the issuer cannot grant powers nobody granted, nor widen them afterwards.
 * (The consent mechanism is ASSUMED, like the rest of the DALION format.)
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Approver, MandateVerifier } from '@backendkit-labs/agent-core';
import { scriptedProvider, mockTransport } from '@backendkit-labs/agent-testkit';
import { AGENT_ID, buildBuyerAgent, objectOf } from '../agent';
import { AGENT_DALION_IDENTITY, DalionSim } from '../providers/dalion-sim';
import { dalionMandateVerifier, type DalionAdapterOptions, type DalionPower } from '../providers/dalion-assumed';
import { identityLayer, type IdentityAuditEvent } from '../identity/prototype';

const nowS = () => Math.floor(Date.now() / 1000);
const TV_1000: DalionPower = { action: 'buy', object: 'television', max: { value: 1000, currency: 'EUR' } };
const CARLOS = 'did:dalion:person:carlos';
const ANA = 'did:dalion:person:ana';
/** The application's ids are not DALION's: this is the operator's mapping. */
const HUMANS: Record<string, string> = { 'u-1001': CARLOS, 'u-1002': ANA };

describe('for whom the agent works: the human of the credential', () => {
    let dir: string;
    let dalion: DalionSim;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'human-'));
        dalion = new DalionSim();
        dalion.registerAgent(AGENT_ID, AGENT_DALION_IDENTITY);
        dalion.registerHuman(CARLOS);
        dalion.registerHuman(ANA);
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const log = () => join(dir, 'audit.ndjson');
    const events = () => readFileSync(log(), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).event as IdentityAuditEvent);
    const buyEvent = () => events().find(e => e.tool === 'buy_supplies')!;
    const mandateOf = (e: IdentityAuditEvent) => e.mandate as unknown as Record<string, unknown>;

    const credential = (over: Record<string, unknown> = {}) => dalion.issue({
        agent: AGENT_DALION_IDENTITY, represents: CARLOS, assurance: 'high', expiresAt: nowS() + 3600, powers: [TV_1000], ...over,
    });
    const verifier = (cred: () => string | undefined, extra: Partial<DalionAdapterOptions> = {}): MandateVerifier => dalionMandateVerifier({
        trustedIssuers: { [dalion.issuer]: dalion.publicKey }, credentialFor: () => cred(), objectOf,
        humanIdOf: (userId) => HUMANS[userId], humanKeyOf: (id, kid) => dalion.humanPublicKey(id, kid), ...extra,
    });
    const asker = (): Approver & { asked: number } => {
        const a = { asked: 0, ref: { kind: 'human' as const, id: 'lead' }, request: async () => { a.asked++; return { decision: 'approve' as const, by: { kind: 'human' as const, id: 'lead' }, at: new Date().toISOString() }; } };
        return a;
    };

    function agent(v: MandateVerifier, userId = 'u-1001', approver?: Approver) {
        return buildBuyerAgent({
            provider: scriptedProvider([{ tool_calls: [{ id: 'c', name: 'buy_supplies', args: { item: 'television', amount: 500, currency: 'EUR' } }] }, { content: 'done' }] as never),
            transport: mockTransport().transport, userId, verifier: v, ...(approver ? { approver } : {}),
            agentIdentity: identityLayer({ provider: dalion.identityProvider(), require: true }),
            auditLogPath: log(), checkpointsPath: join(dir, 'cp.ndjson'),
        });
    }
    const refused = async (v: MandateVerifier, why: RegExp, userId = 'u-1001') => {
        const approver = asker();
        const a = agent(v, userId, approver);
        await a.engine.run('buy a television');
        expect(a.purchases).toHaveLength(0);
        expect(approver.asked).toBe(0);                // no power at all: nobody is asked to approve it
        const ev = buyEvent();
        expect(ev.decision).toBe('deny');
        expect(ev.reason).toMatch(why);
    };

    describe('the application\'s person and the provider\'s person are mapped', () => {
        it('the application says "u-1001"; the credential represents did:dalion:person:carlos; the operator maps one to the other', async () => {
            const a = agent(verifier(() => credential()));
            await a.engine.run('buy a television');
            expect(a.purchases).toHaveLength(1);
            const m = mandateOf(buyEvent());
            expect(m.subject).toBe('u-1001');                                                     // what the framework compares with `userId`
            expect(m.represents).toEqual({ id: CARLOS, kind: 'person', assurance: 'high', consent: 'verified' });   // what the provider says, and what was checked
        });

        it('a person the application cannot name in the provider\'s terms is refused', async () => {
            await refused(verifier(() => credential()), /no identifier for this person/, 'u-9999');
        });

        it('the engine does not say who the agent acts for: refused', async () => {
            await refused(verifier(() => credential()), /does not say who the agent acts for/, '');
        });

        it('a credential of ANOTHER person is no power at all: denied, and nobody is asked (it is not "out of scope")', async () => {
            await refused(verifier(() => credential({ represents: ANA })), /empowers another person than the one the agent acts for/);
        });

        it('...and it is the SAME refusal when the application acts for the other person with the first one\'s credential', async () => {
            await refused(verifier(() => credential()), /empowers another person/, 'u-1002');
        });
    });

    describe('the person consents', () => {
        it('a credential with no consent of the person is refused by default', async () => {
            await refused(verifier(() => credential({ consent: false })), /carries no consent of the person/);
        });

        it('a deployment may accept it, and the audit says the consent was not there', async () => {
            const a = agent(verifier(() => credential({ consent: false }), { requireConsent: false }));
            await a.engine.run('buy a television');
            expect(a.purchases).toHaveLength(1);
            expect((mandateOf(buyEvent()).represents as Record<string, unknown>).consent).toBe('none');
        });

        it('a consent signed by SOMEBODY ELSE\'S key does not count', async () => {
            await refused(verifier(() => credential({ consent: { by: ANA } })), /cannot be checked/);
        });

        it('a consent whose key is not one the operator trusts for that person cannot be checked', async () => {
            await refused(verifier(() => credential(), { humanKeyOf: () => undefined }), /cannot be checked/);
        });

        it('THE ISSUER CANNOT WIDEN WHAT THE PERSON AGREED TO: same credential, limit raised, re-signed by the issuer', async () => {
            const widened = dalion.reissueWith(credential(), p => { (p.powers as DalionPower[])[0]!.max!.value = 50_000; });
            await refused(verifier(() => widened), /person did not consent to these powers/);
        });

        it('...nor add a power the person never granted', async () => {
            const extra = dalion.reissueWith(credential(), p => { (p.powers as DalionPower[]).push({ action: 'sign' }); });
            await refused(verifier(() => extra), /person did not consent to these powers/);
        });

        it('...nor hand the same consent to another agent', async () => {
            dalion.registerAgent('thief', 'did:dalion:agent:thief-01');
            const moved = dalion.reissueWith(credential(), p => { p.sub = 'did:dalion:agent:thief-01'; });
            // the credential now names the thief; the engine's agent (buyer) is refused for the identity mismatch first, which is the point
            await refused(verifier(() => moved), /another agent identity/);
        });
    });

    describe('who the human is: a person or a legal entity, and how well they were identified', () => {
        it('a legal entity can be represented, and the audit says so', async () => {
            const COMPANY = 'did:dalion:org:acme-sl';
            dalion.registerHuman(COMPANY);
            const humans: Record<string, string> = { ...HUMANS, 'u-1001': COMPANY };
            const a = agent(verifier(() => dalion.issue({ agent: AGENT_DALION_IDENTITY, represents: COMPANY, kind: 'legal-entity', assurance: 'substantial', expiresAt: nowS() + 3600, powers: [TV_1000] }), { humanIdOf: (u) => humans[u] }));
            await a.engine.run('buy a television');
            expect(a.purchases).toHaveLength(1);
            expect(mandateOf(buyEvent()).represents).toMatchObject({ id: COMPANY, kind: 'legal-entity', assurance: 'substantial' });
        });

        it('a credential that does not say whether it represents a person or an entity is refused', async () => {
            await refused(verifier(() => credential({ payload: { represents: { id: CARLOS } } })), /person or a legal entity/);
            await refused(verifier(() => credential({ payload: { represents: { id: CARLOS, kind: 'robot' } } })), /person or a legal entity/);
        });

        it('a deployment can demand a minimum assurance of the person', async () => {
            await refused(verifier(() => credential({ assurance: 'substantial' }), { minAssurance: 'high' }), /lower assurance/);
            await refused(verifier(() => credential({ assurance: undefined }), { minAssurance: 'high' }), /lower assurance/);
            const ok = agent(verifier(() => credential({ assurance: 'high' }), { minAssurance: 'high' }));
            await ok.engine.run('buy a television');
            expect(ok.purchases).toHaveLength(1);
        });

        it('without a minimum, the assurance is only recorded', async () => {
            const a = agent(verifier(() => credential({ assurance: 'low' })));
            await a.engine.run('buy a television');
            expect(a.purchases).toHaveLength(1);
            expect((mandateOf(buyEvent()).represents as Record<string, unknown>).assurance).toBe('low');
        });
    });
});
