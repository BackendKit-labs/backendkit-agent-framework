/**
 * SD-JWT, as standardised (RFC 9901), for the credentials of an eIDAS 2 wallet ecosystem (SD-JWT VC is one of the two attestation formats of
 * the EUDI wallet; the other is ISO mdoc). Nothing here is specific to any identity provider: it is the container, and the container IS
 * public. What goes INSIDE a power-of-representation credential is not (no public schema was found), and stays with the provider adapter.
 *
 * What it does, following the RFC:
 *   - splits `<issuer-signed JWT>~<disclosure>~...~<optional KB-JWT>`;
 *   - resolves the Disclosures into the claims: object properties (`_sd`) and array elements (`{"...": digest}`), refusing what the RFC says
 *     a verifier MUST refuse (a digest used twice, a Disclosure no digest points to, a claim that would overwrite another, `_sd`/`...` as names,
 *     a hash algorithm other than SHA-256);
 *   - builds and verifies the Key Binding JWT: `typ` `kb+jwt`, `iat`, `aud`, `nonce` and `sd_hash` over `<jwt>~<disclosures~>`, signed with the key
 *     the credential names in `cnf`.
 *
 * Not covered: the issuer's trust chain (`x5c`, trusted lists), non-EdDSA keys for the holder, the recursive `_sd` of nested arrays of arrays.
 */
import { createHash, createPublicKey, verify as edVerify, type KeyObject } from 'node:crypto';

const b64u = (b: Buffer | string): string => Buffer.from(b).toString('base64url');
const sha256b64u = (ascii: string): string => createHash('sha256').update(ascii, 'ascii').digest('base64url');
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface SdJwtParts {
    /** The issuer-signed JWT. */
    jwt: string;
    /** The Disclosures, as they travel (base64url). */
    disclosures: string[];
    /** The Key Binding JWT, if the string already is a presentation. */
    kb?: string;
}

/** `<jwt>~<d1>~<d2>~[kb]`. The last segment is empty when there is no KB-JWT. */
export function splitSdJwt(compact: string): SdJwtParts | { error: string } {
    const parts = compact.split('~');
    const jwt = parts[0]!;
    if (jwt.length === 0) return { error: 'the credential has no issuer-signed part' };
    if (parts.length === 1) return { jwt, disclosures: [] };                  // a bare JWT, with no tilde
    const last = parts[parts.length - 1]!;
    const disclosures = parts.slice(1, -1);
    if (disclosures.some(d => d.length === 0)) return { error: 'the credential has an empty Disclosure' };
    return last.length > 0 ? { jwt, disclosures, kb: last } : { jwt, disclosures };
}

/** The text `sd_hash` covers: the issuer-signed JWT and the selected Disclosures, each followed by a tilde. */
export const sdHashInput = (jwt: string, disclosures: string[]): string => `${jwt}~${disclosures.map(d => `${d}~`).join('')}`;

export type Resolved = { ok: true; claims: Record<string, unknown> } | { ok: false; reason: string };

/** Puts the Disclosures back into the claims. Refuses everything RFC 9901 says to refuse. */
export function resolveDisclosures(payload: Record<string, unknown>, disclosures: string[]): Resolved {
    if (payload._sd_alg !== undefined && payload._sd_alg !== 'sha-256') return { ok: false, reason: `the hash algorithm "${String(payload._sd_alg)}" for Disclosures is not accepted` };

    const byDigest = new Map<string, unknown[]>();
    for (const raw of disclosures) {
        const digest = sha256b64u(raw);
        if (byDigest.has(digest)) return { ok: false, reason: 'the same Disclosure appears twice' };
        let parsed: unknown;
        try { parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'a Disclosure is not valid' }; }
        if (!Array.isArray(parsed) || (parsed.length !== 2 && parsed.length !== 3) || typeof parsed[0] !== 'string') return { ok: false, reason: 'a Disclosure is not a salted claim' };
        byDigest.set(digest, parsed);
    }

    const used = new Set<string>();
    let failure: string | undefined;
    const fail = (reason: string): undefined => { failure ??= reason; return undefined; };

    const walk = (node: unknown, depth: number): unknown => {
        if (depth > 32) return fail('the credential is nested too deep');
        if (Array.isArray(node)) {
            const out: unknown[] = [];
            for (const element of node) {
                if (isObject(element) && Object.keys(element).length === 1 && '...' in element) {
                    const digest = element['...'];
                    if (typeof digest !== 'string') return fail('an array element digest is not a string');
                    const disclosed = byDigest.get(digest);
                    if (!disclosed) continue;                                  // a decoy: nobody disclosed it
                    if (used.has(digest)) return fail('a Disclosure is referenced twice');
                    used.add(digest);
                    if (disclosed.length !== 2) return fail('an array element Disclosure must have two parts');
                    out.push(walk(disclosed[1], depth + 1));
                } else out.push(walk(element, depth + 1));
            }
            return out;
        }
        if (!isObject(node)) return node;
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(node)) {
            if (key === '_sd') continue;
            out[key] = walk(value, depth + 1);
        }
        const sd = node._sd;
        if (sd !== undefined) {
            if (!Array.isArray(sd) || !sd.every(d => typeof d === 'string')) return fail('_sd is not an array of digests');
            for (const digest of sd as string[]) {
                const disclosed = byDigest.get(digest);
                if (!disclosed) continue;                                      // a decoy digest
                if (used.has(digest)) return fail('a Disclosure is referenced twice');
                used.add(digest);
                if (disclosed.length !== 3 || typeof disclosed[1] !== 'string') return fail('an object property Disclosure must have three parts');
                const name = disclosed[1];
                if (name === '_sd' || name === '...') return fail(`a Disclosure may not name the claim "${name}"`);
                if (name in out) return fail(`a Disclosure would overwrite the claim "${name}"`);
                out[name] = walk(disclosed[2], depth + 1);
            }
        }
        return out;
    };

    const claims = walk(payload, 0) as Record<string, unknown> | undefined;
    if (failure || !claims) return { ok: false, reason: failure ?? 'the credential could not be read' };
    if (used.size !== byDigest.size) return { ok: false, reason: 'a Disclosure is not referenced by any digest of the credential' };
    delete claims._sd_alg;
    return { ok: true, claims };
}

// ── Key Binding ─────────────────────────────────────────────────────────────────────────────────────────────

export interface KbSigningInput {
    /** What the holder's key has to sign, as bytes: `<header>.<payload>`. */
    signingInput: string;
    payload: { iat: number; aud: string; nonce: string; sd_hash: string };
}

/** The KB-JWT a holder signs for THIS verification: its audience, its nonce, and the exact SD-JWT it presents. */
export function kbSigningInput(o: { jwt: string; disclosures: string[]; aud: string; nonce: string; iat: number; alg?: string }): KbSigningInput {
    const payload = { iat: o.iat, aud: o.aud, nonce: o.nonce, sd_hash: sha256b64u(sdHashInput(o.jwt, o.disclosures)) };
    const header = { typ: 'kb+jwt', alg: o.alg ?? 'EdDSA' };
    return { signingInput: `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`, payload };
}

export interface KbVerifyOptions {
    /** The holder's key, from the credential's `cnf`. */
    key: KeyObject;
    jwt: string;
    disclosures: string[];
    /** This verifier's identifier: a KB-JWT made for another verifier is not valid here. */
    aud: string;
    /** What this verifier asked the holder to sign: a KB-JWT answering another request is a replay. */
    nonce: string;
    now: Date;
    /** How far the KB-JWT's `iat` may be from now, in seconds. Default 120. */
    windowSeconds?: number;
}

export function verifyKbJwt(kb: string, o: KbVerifyOptions): { ok: true } | { ok: false; reason: string } {
    const bad = (reason: string) => ({ ok: false as const, reason });
    const [h, p, s, ...extra] = kb.split('.');
    if (!h || !p || !s || extra.length > 0) return bad('the key binding proof is not a JWT');
    let header: Record<string, unknown>, payload: Record<string, unknown>;
    try { header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8')); payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')); } catch { return bad('the key binding proof is not readable'); }
    if (header.typ !== 'kb+jwt') return bad('the key binding proof does not have the type "kb+jwt"');
    if (header.alg !== 'EdDSA') return bad(`the key binding algorithm "${String(header.alg)}" is not accepted`);
    let signed = false;
    try { signed = edVerify(null, Buffer.from(`${h}.${p}`, 'ascii'), o.key.type === 'private' ? createPublicKey(o.key) : o.key, Buffer.from(s, 'base64url')); } catch { signed = false; }
    if (!signed) return bad('the key binding proof was not signed by the key the credential is tied to');
    if (payload.aud !== o.aud) return bad('the key binding proof was made for another verifier');
    if (payload.nonce !== o.nonce) return bad('the key binding proof does not answer this request (nonce)');
    if (payload.sd_hash !== sha256b64u(sdHashInput(o.jwt, o.disclosures))) return bad('the key binding proof was made for a different presentation of the credential (sd_hash)');
    const window = o.windowSeconds ?? 120;
    if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat)) return bad('the key binding proof has no creation time');
    if (Math.abs(o.now.getTime() / 1000 - payload.iat) > window) return bad('the key binding proof is not fresh');
    return { ok: true };
}

// ── For issuers (the simulator, tests) ──────────────────────────────────────────────────────────────────────

/**
 * Hides `names` (top-level claims) behind Disclosures. Returns the payload with their digests in `_sd` and the Disclosures. `decoys` adds
 * digests nobody can open, as an issuer does to hide how many claims there are.
 */
export function hideClaims(payload: Record<string, unknown>, names: string[], decoys = 0): { payload: Record<string, unknown>; disclosures: string[] } {
    const out: Record<string, unknown> = { ...payload };
    const digests: string[] = [];
    const disclosures: string[] = [];
    for (const name of names) {
        if (!(name in out)) continue;
        const salt = b64u(createHash('sha256').update(`${name}:${Math.random()}`).digest().subarray(0, 16));
        const disclosure = b64u(JSON.stringify([salt, name, out[name]]));
        delete out[name];
        digests.push(sha256b64u(disclosure));
        disclosures.push(disclosure);
    }
    for (let i = 0; i < decoys; i++) digests.push(sha256b64u(`decoy:${i}:${Math.random()}`));
    if (digests.length > 0) { out._sd = digests.sort(); out._sd_alg = 'sha-256'; }
    return { payload: out, disclosures };
}
