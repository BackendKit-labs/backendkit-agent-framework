/**
 * Compact JWS, only what a mandate needs, with `node:crypto` and nothing else. Two algorithms are accepted, `EdDSA` (Ed25519) and
 * `ES256` (ECDSA on P-256). Everything else is refused, `none` and the symmetric ones included: a verifier that accepts the
 * algorithm the token asks for can be made to accept a token signed with a key the attacker chose.
 */
import { createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify, type KeyObject } from 'node:crypto';

export type KeyInput = string | KeyObject;
export type JwsAlgorithm = 'EdDSA' | 'ES256';
export const ALGORITHMS: readonly JwsAlgorithm[] = ['EdDSA', 'ES256'];

export interface JwsHeader { alg: string; typ?: string; kid?: string; [k: string]: unknown }

const b64 = (data: Buffer | string): string => Buffer.from(data).toString('base64url');
const BASE64URL = /^[A-Za-z0-9_-]*$/;

const toPublic = (k: KeyInput): KeyObject => {
    if (typeof k === 'string') return createPublicKey(k);
    return k.type === 'private' ? createPublicKey(k) : k;
};

/** Does the key belong to the algorithm? A key of another kind never verifies. */
function keyMatches(alg: JwsAlgorithm, key: KeyObject): boolean {
    if (alg === 'EdDSA') return key.asymmetricKeyType === 'ed25519';
    return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1';
}

export interface ParsedJws { header: JwsHeader; payload: Record<string, unknown>; signingInput: string; signature: Buffer }

/** Splits and decodes a compact JWS, or says what is wrong with it. Does not verify the signature. */
export function parseJws(token: string): { ok: true; jws: ParsedJws } | { ok: false; reason: string } {
    const parts = token.split('.');
    if (parts.length !== 3) return { ok: false, reason: 'not a compact JWS (it needs three parts)' };
    if (!parts.every(p => BASE64URL.test(p))) return { ok: false, reason: 'not base64url' };
    let header: unknown;
    let payload: unknown;
    try {
        header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8'));
        payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
    } catch {
        return { ok: false, reason: 'the header or the payload is not JSON' };
    }
    if (!header || typeof header !== 'object' || Array.isArray(header) || typeof (header as JwsHeader).alg !== 'string') return { ok: false, reason: 'the header has no alg' };
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, reason: 'the payload is not an object' };
    return { ok: true, jws: { header: header as JwsHeader, payload: payload as Record<string, unknown>, signingInput: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2]!, 'base64url') } };
}

/** Checks the signature against ONE key. The algorithm comes from the verifier's list, never only from the token. */
export function verifyJws(jws: ParsedJws, key: KeyInput, allowed: readonly JwsAlgorithm[] = ALGORITHMS): boolean {
    const alg = jws.header.alg as JwsAlgorithm;
    if (!allowed.includes(alg) || !ALGORITHMS.includes(alg)) return false;
    let publicKey: KeyObject;
    try { publicKey = toPublic(key); } catch { return false; }
    if (!keyMatches(alg, publicKey)) return false;
    const data = Buffer.from(jws.signingInput);
    try {
        return alg === 'EdDSA'
            ? nodeVerify(null, data, publicKey, jws.signature)
            : nodeVerify('sha256', data, { key: publicKey, dsaEncoding: 'ieee-p1363' }, jws.signature);
    } catch {
        return false;
    }
}

/** Signs a payload as a compact JWS. For issuers that live in the same project (tests, demos, an operator who issues its own mandates). */
export function signJws(privateKey: KeyInput, header: JwsHeader, payload: Record<string, unknown>): string {
    const key = typeof privateKey === 'string' ? createPrivateKey(privateKey) : privateKey;
    const alg = header.alg as JwsAlgorithm;
    if (!ALGORITHMS.includes(alg) || !keyMatches(alg, key)) throw new Error(`the key does not fit the algorithm ${String(header.alg)} (use Ed25519 with EdDSA, P-256 with ES256)`);
    const input = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(payload))}`;
    const sig = alg === 'EdDSA'
        ? nodeSign(null, Buffer.from(input), key)
        : nodeSign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
    return `${input}.${sig.toString('base64url')}`;
}
