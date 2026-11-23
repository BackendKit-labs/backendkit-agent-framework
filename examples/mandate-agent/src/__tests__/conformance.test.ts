/**
 * CONFORMANCE: what ANY identity provider's adapter has to do, whatever the format of its credential. The same scenarios run against three
 * different formats (an SD-JWT VC, a W3C VC-JWT, and the reference profile of `agent-mandates`), asserting OUTCOMES (did it buy alone, did it
 * ask a person, was it refused without asking) and never the wording of a message, since wording is format-specific.
 *
 * Adding a provider tomorrow means: write its adapter, write a harness below, and pass this. The framework does not change.
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Approver, MandateVerifier } from '@backendkit-labs/agent-core';
import { scriptedProvider, mockTransport } from '@backendkit-labs/agent-testkit';
import { issueMandate, jwtMandateVerifier } from '@backendkit-labs/agent-mandates';
import { AGENT_ID, buildBuyerAgent, objectOf } from '../agent';
import { identityLayer } from '../identity/prototype';
import { AGENT_DALION_IDENTITY, DalionSim } from '../providers/dalion-sim';
import { dalionMandateVerifier } from '../providers/dalion-assumed';
import { VcJwtSim } from '../providers/vc-jwt-sim';
import { vcJwtMandateVerifier } from '../providers/vc-jwt-assumed';

const nowS = () => Math.floor(Date.now() / 1000);

/** A credential, in NEUTRAL terms. Each harness translates it into its own format. */
interface Spec {
    human: string;
    verb: string;
    object: string;
    max: number;
    currency: string;
    ttl: number;
    notBefore?: number;
    agentIdentity?: string;
    id?: string;
    /** Signed by a key nobody trusts, while claiming the trusted issuer. */
    forged?: boolean;
    /** Issued by an issuer the deployment does not trust. */
    untrustedIssuer?: boolean;
    /** The person did not consent. */
    noConsent?: boolean;
    /** The power carries a restriction the framework has no place for (a daily cap, a time window). */
    unknownRestriction?: boolean;
}

interface Harness {
    issue(spec: Spec): string;
    verifier(credential: () => string | undefined): MandateVerifier;
    revoke(credentialId: string): void;
    /** What this FORMAT can express, so a scenario that does not apply is skipped, not faked. */
    can: { identityBinding: boolean; unknownRestriction: boolean; consent: boolean; denyOtherPerson: boolean };
}

const baseSpec = (over: Partial<Spec> = {}): Spec => ({ human: 'carlos', verb: 'buy', object: 'television', max: 1000, currency: 'EUR', ttl: 3600, ...over });

// ── three formats ───────────────────────────────────────────────────────────────────────────────────────────────────

function dalionHarness(): Harness {
    const sim = new DalionSim();
    const other = new DalionSim('https://other-issuer.example');
    sim.registerHuman('carlos'); sim.registerHuman('ana'); other.registerHuman('carlos');
    return {
        can: { identityBinding: true, unknownRestriction: true, consent: true, denyOtherPerson: true },
        issue: (s) => (s.untrustedIssuer ? other : sim).issue({
            agent: s.agentIdentity ?? AGENT_DALION_IDENTITY, represents: s.human, expiresAt: nowS() + s.ttl, ...(s.notBefore !== undefined ? { notBefore: s.notBefore } : {}),
            ...(s.id ? { id: s.id } : {}), ...(s.noConsent ? { consent: false as const } : {}),
            powers: [{ action: s.verb, object: s.object, max: { value: s.max, currency: s.currency }, ...(s.unknownRestriction ? { maxPerDay: 1 } : {}) } as never],
        }, s.forged ? generateKeyPairSync('ed25519').privateKey : undefined),
        verifier: (credential) => dalionMandateVerifier({
            trustedIssuers: { [sim.issuer]: sim.publicKey }, credentialFor: () => credential(), objectOf,
            humanIdOf: (u) => u, humanKeyOf: (id, kid) => sim.humanPublicKey(id, kid), isRevoked: sim.isRevoked,
        }),
        revoke: (id) => sim.revoke(id),
    };
}

function vcJwtHarness(): Harness {
    const sim = new VcJwtSim();
    const other = new VcJwtSim();
    for (const s of [sim, other]) { s.registerHuman('carlos'); s.registerHuman('ana'); }
    return {
        can: { identityBinding: true, unknownRestriction: true, consent: true, denyOtherPerson: true },
        issue: (s) => (s.untrustedIssuer ? other : sim).issue({
            agent: s.agentIdentity ?? AGENT_DALION_IDENTITY, actingFor: s.human, expiresAt: nowS() + s.ttl, ...(s.notBefore !== undefined ? { notBefore: s.notBefore } : {}),
            ...(s.id ? { id: s.id } : {}), ...(s.noConsent ? { consent: false as const } : {}),
            powers: [{ action: s.verb, object: s.object, max: { value: s.max, currency: s.currency } }],
            ...(s.unknownRestriction ? { authorizationExtras: { validBetween: ['09:00', '18:00'] } } : {}),
        }, s.forged ? generateKeyPairSync('ed25519').privateKey : undefined, s.untrustedIssuer ? sim.issuer : undefined),
        verifier: (credential) => vcJwtMandateVerifier({
            trustedIssuers: { [sim.issuer]: sim.publicKey }, credentialFor: () => credential(), objectOf,
            humanIdOf: (u) => u, humanKeyOf: (id, kid) => sim.humanPublicKey(id, kid), isRevoked: sim.isRevoked,
        }),
        revoke: (id) => sim.revoke(id),
    };
}

function referenceHarness(): Harness {
    const company = generateKeyPairSync('ed25519');
    const unknown = generateKeyPairSync('ed25519');
    const revoked = new Set<string>();
    return {
        // The reference profile names TOOLS (not verbs), has no consent, no identity binding, and sends another person's credential to a person.
        can: { identityBinding: false, unknownRestriction: false, consent: false, denyOtherPerson: false },
        issue: (s) => issueMandate({
            privateKey: s.forged || s.untrustedIssuer ? unknown.privateKey : company.privateKey, alg: 'EdDSA', issuer: 'did:example:company', subject: s.human, agent: AGENT_ID,
            actions: ['buy_supplies'], resources: [s.object], limits: { amount: { max: s.max, currency: s.currency } },
            expiresAt: nowS() + s.ttl, ...(s.notBefore !== undefined ? { notBefore: s.notBefore } : {}), ...(s.id ? { id: s.id } : {}),
        }),
        verifier: (credential) => jwtMandateVerifier({ trustedIssuers: { 'did:example:company': company.publicKey }, credentialFor: () => credential(), isRevoked: (m) => revoked.has(m.id) }),
        revoke: (id) => { revoked.add(id); },
    };
}

// ── the scenarios ───────────────────────────────────────────────────────────────────────────────────────────────────

describe.each([
    ['SD-JWT VC (DALION, assumed payload)', dalionHarness],
    ['W3C VC-JWT (assumed payload)', vcJwtHarness],
    ['the reference profile of agent-mandates', referenceHarness],
] as const)('conformance of the adapter for: %s', (_name, make) => {
    const caps = make().can;                  // what this format can express, known up front so the others are SKIPPED, not silently passed
    let dir: string;
    let h: Harness;
    let idp: DalionSim;                       // the identity provider of the AGENT, independent of who issues the credential
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'conformance-')); h = make(); idp = new DalionSim(); idp.registerAgent(AGENT_ID, AGENT_DALION_IDENTITY); });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const rejecting: Approver & { asked: number } = {
        asked: 0, ref: { kind: 'human', id: 'lead' },
        request: async () => { rejecting.asked++; return { decision: 'reject', by: { kind: 'human', id: 'lead' }, at: new Date().toISOString() }; },
    };

    /** One purchase under this credential, with an approver that always says no: what is left standing is what the mandate allowed ALONE. */
    async function buy(credential: string | undefined, call: { amount?: number; item?: string } = {}) {
        rejecting.asked = 0;
        const a = buildBuyerAgent({
            provider: scriptedProvider([{ tool_calls: [{ id: 'c', name: 'buy_supplies', args: { item: call.item ?? 'television', amount: call.amount ?? 500, currency: 'EUR' } }] }, { content: 'done' }] as never),
            transport: mockTransport().transport, userId: 'carlos', verifier: h.verifier(() => credential), approver: rejecting,
            agentIdentity: identityLayer({ provider: idp.identityProvider(), require: true }),
            auditLogPath: join(dir, `a-${Math.random().toString(36).slice(2)}.ndjson`), checkpointsPath: join(dir, `c-${Math.random().toString(36).slice(2)}.ndjson`),
        });
        await a.engine.run('buy');
        return { alone: a.purchases.length === 1, asked: rejecting.asked };
    }
    const refusedOutright = { alone: false, asked: 0 };

    it('buys alone inside the mandate, asking nobody', async () => {
        expect(await buy(h.issue(baseSpec()), { amount: 800 })).toEqual({ alone: true, asked: 0 });
    });

    it('exactly at the limit is inside it', async () => {
        expect(await buy(h.issue(baseSpec()), { amount: 1000 })).toEqual({ alone: true, asked: 0 });
    });

    it('above the limit it asks a person (and does not buy when they say no)', async () => {
        expect(await buy(h.issue(baseSpec()), { amount: 1200 })).toEqual({ alone: false, asked: 1 });
    });

    it('another object than the one empowered asks a person', async () => {
        expect(await buy(h.issue(baseSpec()), { item: 'laptop', amount: 300 })).toEqual({ alone: false, asked: 1 });
    });

    it('a credential of ANOTHER person never lets the agent buy alone', async () => {
        const r = await buy(h.issue(baseSpec({ human: 'ana' })));
        expect(r.alone).toBe(false);
        if (h.can.denyOtherPerson) expect(r.asked).toBe(0);               // no power at all: nobody is asked
    });

    it('no credential: refused, nobody asked', async () => { expect(await buy(undefined)).toEqual(refusedOutright); });
    it('an expired credential: refused, nobody asked', async () => { expect(await buy(h.issue(baseSpec({ ttl: -3600, notBefore: nowS() - 7200 })))).toEqual(refusedOutright); });
    it('a credential not valid yet: refused, nobody asked', async () => { expect(await buy(h.issue(baseSpec({ notBefore: nowS() + 3600, ttl: 7200 })))).toEqual(refusedOutright); });
    it('a credential signed by a key nobody trusts: refused, nobody asked', async () => { expect(await buy(h.issue(baseSpec({ forged: true })))).toEqual(refusedOutright); });
    it('a credential from an issuer the deployment does not trust: refused, nobody asked', async () => { expect(await buy(h.issue(baseSpec({ untrustedIssuer: true })))).toEqual(refusedOutright); });
    it('garbage: refused, nobody asked', async () => { expect(await buy('not-a-credential')).toEqual(refusedOutright); });

    it('a revoked credential: refused, nobody asked', async () => {
        h.revoke('cred-to-revoke');
        expect(await buy(h.issue(baseSpec({ id: 'cred-to-revoke' })))).toEqual(refusedOutright);
    });

    it('a credential whose expiry is far away still has an end (no open-ended power)', async () => {
        // every format must carry an expiry: the neutral spec always has one, so the check is that it was honoured, not ignored
        expect(await buy(h.issue(baseSpec({ ttl: 1 })), { amount: 10 })).toEqual({ alone: true, asked: 0 });
    });

    describe('what only some formats can express (skipped, not faked, where the format cannot)', () => {
        (caps.unknownRestriction ? it : it.skip)('a power with a restriction the framework has no place for is refused, never silently widened', async () => {
            expect(await buy(h.issue(baseSpec({ unknownRestriction: true })))).toEqual(refusedOutright);
        });

        (caps.identityBinding ? it : it.skip)('a credential issued to another agent identity is refused', async () => {
            expect(await buy(h.issue(baseSpec({ agentIdentity: 'did:example:agent:somebody-else' })))).toEqual(refusedOutright);
        });

        (caps.identityBinding ? it : it.skip)("the adapter ALONE compares the credential's agent with the identity the engine gives it (no other layer is relied on)", async () => {
            const request = (id: string) => ({
                principal: { agentId: AGENT_ID, sessionId: 's', chain: [AGENT_ID], userId: 'carlos', agentIdentity: { id } },
                call: { tool: { name: 'buy_supplies', meta: { capability: 'buy' } } as never, args: { item: 'television' } },
            });
            const cred = h.issue(baseSpec());
            const mine = await h.verifier(() => cred).verify(request(AGENT_DALION_IDENTITY) as never);
            expect(mine.ok).toBe(true);
            const other = await h.verifier(() => cred).verify(request('did:example:agent:somebody-else') as never);
            expect(other.ok).toBe(false);
        });

        (caps.consent ? it : it.skip)('a credential the person never consented to is refused', async () => {
            expect(await buy(h.issue(baseSpec({ noConsent: true })))).toEqual(refusedOutright);
        });
    });
});
