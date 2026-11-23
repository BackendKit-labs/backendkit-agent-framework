/**
 * A stand-in issuer of VC-JWT authorization credentials (see `vc-jwt-assumed.ts`). For tests and demos only.
 */
import { generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto';
import { signJws } from '@backendkit-labs/agent-mandates';
import { consentMessage, type Power } from './common';
import { VC_JWT_TYPE } from './vc-jwt-assumed';

export interface VcIssueOptions {
    /** The identity of the agent (credentialSubject.id). */
    agent: string;
    /** The person or organisation it acts for, in this provider's identifiers. */
    actingFor: string;
    type?: 'Person' | 'Organization';
    assurance?: string;
    powers: Power[];
    id?: string;
    notBefore?: number;
    expiresAt: number;
    /** `false` leaves the person's consent out. Default: signed with the key of `actingFor` if registered. */
    consent?: false | { by: string };
    /** Extra fields added to every authorization, to build a restriction the adapter cannot enforce. */
    authorizationExtras?: Record<string, unknown>;
    /** Override anything in the payload. */
    payload?: Record<string, unknown>;
}

export class VcJwtSim {
    readonly issuer = 'https://issuer.vc.example';
    readonly publicKey: KeyObject;
    private readonly privateKey: KeyObject;
    private readonly humans = new Map<string, { kid: string; privateKey: KeyObject; publicKey: KeyObject }>();
    private readonly revoked = new Set<string>();
    private n = 0;

    constructor() {
        const pair = generateKeyPairSync('ed25519');
        this.publicKey = pair.publicKey;
        this.privateKey = pair.privateKey;
    }

    registerHuman(humanId: string): string {
        const known = this.humans.get(humanId);
        if (known) return known.kid;
        const pair = generateKeyPairSync('ed25519');
        const kid = `${humanId}#vc-consent-1`;
        this.humans.set(humanId, { kid, privateKey: pair.privateKey, publicKey: pair.publicKey });
        return kid;
    }

    humanPublicKey(humanId: string, kid: string): KeyObject | undefined {
        const h = this.humans.get(humanId);
        return h && h.kid === kid ? h.publicKey : undefined;
    }

    issue(o: VcIssueOptions, signedBy: KeyObject = this.privateKey, issuer: string = this.issuer): string {
        const id = o.id ?? `vc-cred-${++this.n}`;
        const kind = o.type === 'Organization' ? 'legal-entity' : 'person';
        const acting: Record<string, unknown> = { id: o.actingFor, type: o.type ?? 'Person', ...(o.assurance !== undefined ? { assurance: o.assurance } : {}) };
        const signer = o.consent === false ? undefined : this.humans.get(o.consent?.by ?? o.actingFor);
        if (signer) {
            acting.consent = {
                kid: signer.kid,
                signature: edSign(null, consentMessage({ jti: id, agent: o.agent, exp: o.expiresAt, represents: { id: o.actingFor, kind }, powers: o.powers }), signer.privateKey).toString('base64url'),
            };
        }
        const authorizations = o.powers.map(p => ({
            permission: p.action,
            ...(p.object !== undefined ? { target: p.object } : {}),
            ...(p.max ? { ceiling: { amount: p.max.value, currency: p.max.currency } } : {}),
            ...(o.authorizationExtras ?? {}),
        }));
        const payload: Record<string, unknown> = {
            iss: issuer,
            sub: o.agent,
            jti: id,
            nbf: o.notBefore ?? Math.floor(Date.now() / 1000),
            exp: o.expiresAt,
            vc: {
                '@context': ['https://www.w3.org/2018/credentials/v1'],
                type: ['VerifiableCredential', VC_JWT_TYPE],
                credentialSubject: { id: o.agent, actingFor: acting, authorizations },
                credentialStatus: { type: 'BitstringStatusListEntry', statusPurpose: 'revocation', statusListIndex: String(++this.n), statusListCredential: 'https://status.vc.example/lists/1' },
            },
            ...(o.payload ?? {}),
        };
        return signJws(signedBy, { alg: 'EdDSA', typ: 'JWT' }, payload);
    }

    revoke(credentialId: string): void { this.revoked.add(credentialId); }
    isRevoked = (s: { credentialId: string }): boolean => this.revoked.has(s.credentialId);
}
