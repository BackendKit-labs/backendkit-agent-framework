/**
 * Issues a mandate in the profile the default verifier reads. For tests and demos, and for an operator who empowers its own agents
 * with its own key. A mandate issued by someone else (a company's identity system, a wallet) comes from them, not from here.
 */
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
    actions: string[];
    resources?: string[];
    limits?: Mandate['limits'];
    /** Seconds since the epoch. Default: now. */
    notBefore?: number;
    /** Seconds since the epoch. Required: a mandate has an end. */
    expiresAt: number;
    vct?: string;
}

export function issueMandate(o: IssueMandateOptions): string {
    const payload: Record<string, unknown> = {
        iss: o.issuer,
        sub: o.subject,
        jti: o.id ?? `mandate-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
        iat: Math.floor(Date.now() / 1000),
        nbf: o.notBefore ?? Math.floor(Date.now() / 1000),
        exp: o.expiresAt,
        vct: o.vct ?? MANDATE_VCT,
        mandate: {
            ...(o.agent !== undefined ? { agent: o.agent } : {}),
            actions: o.actions,
            ...(o.resources !== undefined ? { resources: o.resources } : {}),
            ...(o.limits !== undefined ? { limits: o.limits } : {}),
        },
    };
    return signJws(o.privateKey, { alg: o.alg, typ: 'dc+sd-jwt', ...(o.kid !== undefined ? { kid: o.kid } : {}) }, payload);
}
