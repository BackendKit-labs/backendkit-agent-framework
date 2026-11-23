/**
 * A stand-in for DALION, for tests and demos. It is not DALION and it does not speak to it. It plays the three roles the real one is
 * described to play, in an ASSUMED shape:
 *   1. it gives each agent a non-human digital identity (a DID) and keeps its key in "custody" (so it signs for it, asynchronously);
 *   2. it issues credentials of power of representation in the assumed format of `dalion-assumed.ts`, optionally TIED to the agent's key;
 *   3. it keeps a revocation list.
 */
import { generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto';
import { signJws } from '@backendkit-labs/agent-mandates';
import { DALION_ASSUMED_VCT, type DalionPower } from './dalion-assumed';
import type { AgentIdentity, AgentIdentityProvider } from '../identity/prototype';
import { consentMessage } from './common';
import { hideClaims } from '../standards/sd-jwt';

/** The non-human identity the simulator gives to the example's buyer agent (assumed shape). */
export const AGENT_DALION_IDENTITY = 'did:dalion:agent:buyer-01';

export interface IssueOptions {
    /** The non-human identity of the agent the power is for. */
    agent: string;
    /** For whom the agent works (the human's identifier in DALION). */
    represents: string;
    /** A person or a legal entity. Default `person`. */
    kind?: 'person' | 'legal-entity';
    /** How strongly the person was identified (assumed vocabulary: `low`, `substantial`, `high`). */
    assurance?: string;
    /**
     * The person's own signature over the powers. Default: signed with the key of `represents` if that person was registered. `false` leaves
     * it out (a credential the person never consented to).
     */
    consent?: false | { by: string };
    powers: DalionPower[];
    id?: string;
    /** Seconds since the epoch. */
    notBefore?: number;
    expiresAt: number;
    /** Tie the credential to the key of this agent (by its profile id): only whoever holds that key can use it. */
    bindToKeyOf?: string;
    /** Top-level claims to hide behind Disclosures (RFC 9901): the credential then travels as `<jwt>~<disclosure>~...~`. */
    disclose?: string[];
    /** Digests nobody can open, as an issuer adds to hide how many claims there are. */
    decoys?: number;
    /** Override anything in the payload, to build a malformed credential on purpose. */
    payload?: Record<string, unknown>;
}

interface Custody { identity: AgentIdentity; privateKey: KeyObject; publicKey: KeyObject }
interface Human { kid: string; privateKey: KeyObject; publicKey: KeyObject }

export class DalionSim {
    readonly issuer: string;
    readonly publicKey: KeyObject;
    private readonly privateKey: KeyObject;
    private readonly revoked = new Set<string>();
    private readonly agents = new Map<string, Custody>();
    private readonly humans = new Map<string, Human>();
    private n = 0;

    constructor(issuer = 'https://issuer.dalion.example') {
        this.issuer = issuer;
        const pair = generateKeyPairSync('ed25519');
        this.publicKey = pair.publicKey;
        this.privateKey = pair.privateKey;
    }

    /** Gives an agent (by its profile id) an identity and a key in custody. Idempotent. */
    registerAgent(agentId: string, did?: string): AgentIdentity {
        const known = this.agents.get(agentId);
        if (known) return known.identity;
        const pair = generateKeyPairSync('ed25519');
        const identity: AgentIdentity = { id: did ?? `did:dalion:agent:${agentId}-01`, issuer: this.issuer, kid: `${did ?? `did:dalion:agent:${agentId}-01`}#key-1` };
        this.agents.set(agentId, { identity, privateKey: pair.privateKey, publicKey: pair.publicKey });
        return identity;
    }

    /** Gives a person (by their DALION identifier) a key to consent with. Idempotent. In real life the person holds it, not DALION. */
    registerHuman(humanId: string): string {
        const known = this.humans.get(humanId);
        if (known) return known.kid;
        const pair = generateKeyPairSync('ed25519');
        const kid = `${humanId}#consent-1`;
        this.humans.set(humanId, { kid, privateKey: pair.privateKey, publicKey: pair.publicKey });
        return kid;
    }

    /** The public key a person consents with, for whoever verifies their consent. */
    humanPublicKey(humanId: string, kid: string): KeyObject | undefined {
        const h = this.humans.get(humanId);
        return h && h.kid === kid ? h.publicKey : undefined;
    }

    /** The public key of an identity's key, for whoever verifies what it signed. */
    publicKeyOfKid(kid: string): KeyObject | undefined {
        for (const c of this.agents.values()) if (c.identity.kid === kid) return c.publicKey;
        return undefined;
    }

    /** The agent side: how an engine asks DALION who an agent is and gets it to sign. Asynchronous, like a custody service would be. */
    identityProvider(): AgentIdentityProvider {
        return {
            resolve: async (agentId) => { await tick(); return this.agents.get(agentId)?.identity; },
            sign: async (agentId, message) => {
                await tick();
                const c = this.agents.get(agentId);
                if (!c) throw new Error(`no identity in custody for "${agentId}"`);
                return { kid: c.identity.kid!, signature: edSign(null, Buffer.from(message), c.privateKey).toString('base64url') };
            },
        };
    }

    /** A credential signed by this issuer; `signedBy` lets a test sign it with another key (a forgery). */
    issue(o: IssueOptions, signedBy: KeyObject = this.privateKey): string {
        const id = o.id ?? `dalion-cred-${++this.n}`;
        const bound = o.bindToKeyOf ? this.agents.get(o.bindToKeyOf) : undefined;
        if (o.bindToKeyOf && !bound) throw new Error(`no key in custody for "${o.bindToKeyOf}"`);
        const payload: Record<string, unknown> = {
            iss: this.issuer,
            sub: o.agent,
            jti: id,
            iat: Math.floor(Date.now() / 1000),
            nbf: o.notBefore ?? Math.floor(Date.now() / 1000),
            exp: o.expiresAt,
            vct: DALION_ASSUMED_VCT,
            represents: { id: o.represents, kind: o.kind ?? 'person', ...(o.assurance !== undefined ? { assurance: o.assurance } : {}) },
            powers: o.powers,
            status: { status_list: { idx: ++this.n, uri: 'https://status.dalion.example/lists/1' } },
            ...(bound ? { cnf: { kid: bound.identity.kid, jwk: bound.publicKey.export({ format: 'jwk' }) } } : {}),
            ...(o.payload ?? {}),
        };
        // The consent: the PERSON signs what the agent may do for them. It goes inside `represents`, after everything else is fixed.
        const rep = payload.represents as { id?: unknown; kind?: unknown } | undefined;
        const signer = o.consent === false ? undefined : this.humans.get(o.consent?.by ?? o.represents);
        if (signer && rep && typeof rep === 'object') {
            const signature = edSign(null, consentMessage({ jti: payload.jti, agent: payload.sub, exp: payload.exp, represents: { id: rep.id, kind: rep.kind }, powers: payload.powers }), signer.privateKey).toString('base64url');
            (payload.represents as Record<string, unknown>).consent = { kid: signer.kid, signature };
        }
        // An SD-JWT travels as `<jwt>~<disclosure>~...~`. The consent above covers the real values, whatever is hidden.
        const { payload: shown, disclosures } = hideClaims(payload, o.disclose ?? [], o.decoys ?? 0);
        return `${signJws(signedBy, { alg: 'EdDSA', typ: 'dc+sd-jwt' }, shown)}~${disclosures.map(d => `${d}~`).join('')}`;
    }

    /**
     * What a dishonest or careless ISSUER could do: take a credential the person consented to, change it, and sign it again with its own key.
     * The issuer's signature is valid; the person's consent no longer covers what the credential says.
     */
    reissueWith(credential: string, edit: (payload: Record<string, unknown>) => void): string {
        const payload = JSON.parse(Buffer.from(credential.split('.')[1]!, 'base64url').toString()) as Record<string, unknown>;
        edit(payload);
        return `${signJws(this.privateKey, { alg: 'EdDSA', typ: 'dc+sd-jwt' }, payload)}~`;
    }

    revoke(credentialId: string): void { this.revoked.add(credentialId); }
    isRevoked = (s: { credentialId: string }): boolean => this.revoked.has(s.credentialId);
}

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 1));
