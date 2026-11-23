/**
 * Issues a mandate in the profile the default verifier reads. For tests and demos, and for an operator who empowers its own agents
 * with its own key. A mandate issued by someone else (a company's identity system, a wallet) comes from them, not from here.
 */
import { createPublicKey, type KeyObject } from 'node:crypto';
import type { Mandate } from '@backendkit-labs/agent-core';
import { signJws, type JwsAlgorithm, type KeyInput } from './jws';
import { MANDATE_VCT } from './verifier';

export interface IssueMandateOptions {
    privateKey: KeyInput;
    /** `EdDSA` for an Ed25519 key, `ES256` for a P-256 key. */
    alg: JwsAlgorithm;
    kid?: string;
    issuer: string;
    /** Who empowers. */
    subject: string;
    /** The id. Default: a random one. */
    id?: string;
    agent?: string;
    /** The digital identity (SPEC-0044) of the agent it is issued to: the mandate only covers the agent whose identity is this one. */
    agentIdentity?: string;
    /**
     * The public key of the agent (Ed25519): ties the credential to it (`cnf`). The credential is then good only in the hands of whoever can sign with
     * the matching key, and the verifier asks the agent to prove it. Absent: a bearer credential.
     */
    holderKey?: KeyObject | string;
    actions: string[];
    resources?: string[];
    limits?: Mandate['limits'];
    /** Seconds since the epoch. Default: now. */
    notBefore?: number;
    /** Seconds since the epoch. Required: a mandate has an end. */
    expiresAt: number;
    vct?: string;
}

/** The public key as a JWK, from a public or a private key (a private one gives its public half). */
function publicJwk(key: KeyObject | string) {
    const pub = typeof key !== 'string' && key.type === 'public' ? key : createPublicKey(key);
    return pub.export({ format: 'jwk' });
}

export function issueMandate(o: IssueMandateOptions): string {
    const payload: Record<string, unknown> = {
        iss: o.issuer,
        sub: o.subject,
        jti: o.id ?? `mandate-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
        iat: Math.floor(Date.now() / 1000),
        nbf: o.notBefore ?? Math.floor(Date.now() / 1000),
        exp: o.expiresAt,
        ...(o.holderKey !== undefined ? { cnf: { jwk: publicJwk(o.holderKey) } } : {}),
        vct: o.vct ?? MANDATE_VCT,
        mandate: {
            ...(o.agent !== undefined ? { agent: o.agent } : {}),
            ...(o.agentIdentity !== undefined ? { agentIdentity: o.agentIdentity } : {}),
            actions: o.actions,
            ...(o.resources !== undefined ? { resources: o.resources } : {}),
            ...(o.limits !== undefined ? { limits: o.limits } : {}),
        },
    };
    return signJws(o.privateKey, { alg: o.alg, typ: 'dc+sd-jwt', ...(o.kid !== undefined ? { kid: o.kid } : {}) }, payload);
}
