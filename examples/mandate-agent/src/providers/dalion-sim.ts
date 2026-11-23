/**
 * A stand-in for DALION, for tests and demos: it issues credentials in the ASSUMED format of `dalion-assumed.ts` and keeps a
 * revocation list. It is not DALION and it does not speak to it. It exists so the agent can be exercised end to end before the real
 * credential is available.
 */
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { signJws } from '@backendkit-labs/agent-mandates';
import { DALION_ASSUMED_VCT, type DalionPower } from './dalion-assumed';

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
    /** Override anything in the payload, to build a malformed credential on purpose. */
    payload?: Record<string, unknown>;
}

export class DalionSim {
    readonly issuer: string;
    readonly publicKey: KeyObject;
    private readonly privateKey: KeyObject;
    private readonly revoked = new Set<string>();
    private n = 0;

    constructor(issuer = 'did:dalion:issuer:sim') {
        this.issuer = issuer;
        const pair = generateKeyPairSync('ed25519');
        this.publicKey = pair.publicKey;
        this.privateKey = pair.privateKey;
    }

    /** A credential signed by this issuer; `signedBy` lets a test sign it with another key (a forgery). */
    issue(o: IssueOptions, signedBy: KeyObject = this.privateKey): string {
        const id = o.id ?? `dalion-cred-${++this.n}`;
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
            ...(o.payload ?? {}),
        };
        return signJws(signedBy, { alg: 'EdDSA', typ: 'dc+sd-jwt' }, payload);
    }

    revoke(credentialId: string): void { this.revoked.add(credentialId); }
    isRevoked = (s: { credentialId: string }): boolean => this.revoked.has(s.credentialId);
}
