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

/** The non-human identity the simulator gives to the example's buyer agent (assumed shape). */
export const AGENT_DALION_IDENTITY = 'did:dalion:agent:buyer-01';

export interface IssueOptions {
    /** The non-human identity of the agent the power is for. */
    agent: string;
    /** For whom the agent works. */
    represents: string;
    powers: DalionPower[];
    id?: string;
    /** Seconds since the epoch. */
    notBefore?: number;
    expiresAt: number;
    /** Tie the credential to the key of this agent (by its profile id): only whoever holds that key can use it. */
    bindToKeyOf?: string;
    /** Override anything in the payload, to build a malformed credential on purpose. */
    payload?: Record<string, unknown>;
}

interface Custody { identity: AgentIdentity; privateKey: KeyObject; publicKey: KeyObject }

export class DalionSim {
    readonly issuer: string;
    readonly publicKey: KeyObject;
    private readonly privateKey: KeyObject;
    private readonly revoked = new Set<string>();
    private readonly agents = new Map<string, Custody>();
    private n = 0;

    constructor(issuer = 'did:dalion:issuer:sim') {
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
            represents: { id: o.represents },
            powers: o.powers,
            status: { id: `status-${id}` },
            ...(bound ? { cnf: { kid: bound.identity.kid, jwk: bound.publicKey.export({ format: 'jwk' }) } } : {}),
            ...(o.payload ?? {}),
        };
        return signJws(signedBy, { alg: 'EdDSA', typ: 'dc+sd-jwt' }, payload);
    }

    revoke(credentialId: string): void { this.revoked.add(credentialId); }
    isRevoked = (s: { credentialId: string }): boolean => this.revoked.has(s.credentialId);
}

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 1));
