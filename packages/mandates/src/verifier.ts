/**
 * The default verifier of mandates (SPEC-0043 F2): a signed credential in the shape of an SD-JWT VC (a JWT with `iss`, `sub`, `jti`,
 * `nbf`, `exp` and `vct`) that carries the mandate in a `mandate` claim. It is a REFERENCE: it fixes a neutral profile so that
 * agents can work under mandates now. The credential of a specific provider (DALION or any eIDAS 2 wallet) is an adapter that
 * turns its own format into the same {@link Mandate}; see the README.
 *
 * What it checks, and fails closed on each: a compact JWS with an algorithm of its list; a `typ` of its list; an issuer the OPERATOR
 * trusts, with that issuer's key; the signature; the `vct`; a `jti`, a `sub` and an `exp`; the dates; the shape of the `mandate`
 * claim; and a revocation hook. A credential with selective disclosures is refused (not supported yet), not half read.
 *
 * A credential tied to a key (`cnf`, SPEC-0044 F3) is only good in the hands of whoever holds that key: the verifier builds a Key Binding JWT
 * for THIS verification (its audience, a fresh nonce, the credential) and the agent signs it with the key of its digital identity
 * (`request.prove`, given by `mandatePolicy({ agentIdentity })`). No proof, or a proof by another key, is a refusal; a proven one marks the
 * mandate `holderBinding: 'proven'`. A credential with no `cnf` is a bearer one and is marked `none`.
 */
import type { Mandate, MandateRequest, MandateVerification, MandateVerifier } from '@backendkit-labs/agent-core';
import { createPublicKey, randomBytes } from 'node:crypto';
import { ALGORITHMS, parseJws, verifyJws, type JwsAlgorithm, type KeyInput } from './jws';
import { kbSigningInput, verifyKbJwt } from './sd-jwt';

/** The credential type this profile defines. */
export const MANDATE_VCT = 'urn:backendkit:mandate:1';

export interface JwtMandateVerifierOptions {
    /** The issuers you trust and their public keys (PEM or `KeyObject`). A list covers key rotation. Nothing is trusted by default. */
    trustedIssuers: Record<string, KeyInput | KeyInput[]>;
    /** The credential this agent acts under, for this call. `undefined`: there is none, and that is a refusal. */
    credentialFor(request: MandateRequest): string | undefined | Promise<string | undefined>;
    /** Is the mandate revoked? Where to look is yours (a status list, a database). A hook that throws counts as revoked. */
    isRevoked?(mandate: Mandate): boolean | Promise<boolean>;
    /** Accepted `alg`. Default both (`EdDSA`, `ES256`). */
    algorithms?: JwsAlgorithm[];
    /** Accepted header `typ`. Default `dc+sd-jwt`, `vc+sd-jwt` and `mandate+jwt`. */
    types?: string[];
    /** The `vct` of the credential. Default {@link MANDATE_VCT}. */
    vct?: string;
    /**
     * This verifier's identifier, put in the `aud` of the proof of possession: a proof made for another verifier is not valid here. Only used for
     * credentials tied to a key (`cnf`). Default `urn:agent-framework:verifier`.
     */
    audience?: string;
    /** Seconds of clock difference accepted at `nbf` and `exp`. Default 0. */
    leewaySeconds?: number;
    /** Clock, for tests. */
    now?: () => Date;
}

const DEFAULT_AUDIENCE = 'urn:agent-framework:verifier';
const deny = (reason: string): MandateVerification => ({ ok: false, reason });
const iso = (seconds: number): string => new Date(seconds * 1000).toISOString();
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'string' && x.length > 0);

export function jwtMandateVerifier(options: JwtMandateVerifierOptions): MandateVerifier {
    const algorithms = options.algorithms ?? [...ALGORITHMS];
    const types = options.types ?? ['dc+sd-jwt', 'vc+sd-jwt', 'mandate+jwt'];
    const vct = options.vct ?? MANDATE_VCT;
    const leeway = options.leewaySeconds ?? 0;

    return {
        async verify(request: MandateRequest): Promise<MandateVerification> {
            let credential: string | undefined;
            try { credential = await options.credentialFor(request); } catch (err) { return deny(`the credential could not be read: ${err instanceof Error ? err.message : String(err)}`); }
            if (!credential) return deny('this agent holds no mandate');

            // An SD-JWT is `<jwt>~<disclosure>~...~<key binding jwt>`. With no disclosures it is `<jwt>~` (or just the JWT).
            const [token, ...rest] = credential.split('~');
            if (rest.some(part => part.length > 0)) return deny('credentials with selective disclosures or key binding are not supported by this verifier yet');

            const parsed = parseJws(token!);
            if (!parsed.ok) return deny(`the credential is malformed: ${parsed.reason}`);
            const { header, payload } = parsed.jws;
            if (!algorithms.includes(header.alg as JwsAlgorithm)) return deny(`the algorithm "${header.alg}" is not accepted`);
            if (typeof header.typ !== 'string' || !types.includes(header.typ)) return deny(`the credential type "${String(header.typ)}" is not accepted`);

            const issuer = payload.iss;
            if (typeof issuer !== 'string' || issuer.length === 0) return deny('the credential has no issuer (iss)');
            if (!Object.prototype.hasOwnProperty.call(options.trustedIssuers, issuer)) return deny(`the issuer "${issuer}" is not one you trust`);
            const trusted = options.trustedIssuers[issuer]!;
            const keys = Array.isArray(trusted) ? trusted : [trusted];
            if (!keys.some(k => verifyJws(parsed.jws, k, algorithms))) return deny('the signature does not verify with the keys of that issuer');

            // From here on the signer is who it says it is; what it signed still has to be a mandate.
            if (payload.vct !== vct) return deny(`the credential is not a "${vct}" credential`);
            const { jti, sub, nbf, exp, mandate: claim } = payload;
            if (typeof jti !== 'string' || jti.length === 0) return deny('the credential has no id (jti)');
            if (typeof sub !== 'string' || sub.length === 0) return deny('the credential does not say who empowers (sub)');
            if (typeof exp !== 'number' || !Number.isFinite(exp)) return deny('the credential has no expiry (exp): an open-ended mandate is not accepted');
            if (nbf !== undefined && (typeof nbf !== 'number' || !Number.isFinite(nbf))) return deny('the start of the credential (nbf) cannot be read');

            const nowSeconds = (options.now?.() ?? new Date()).getTime() / 1000;
            if (nowSeconds > exp + leeway) return deny('the credential has expired');
            if (typeof nbf === 'number' && nowSeconds < nbf - leeway) return deny('the credential is not valid yet');

            if (!claim || typeof claim !== 'object' || Array.isArray(claim)) return deny('the credential has no mandate claim');
            const m = claim as Record<string, unknown>;
            if (!isStringArray(m.actions)) return deny('the mandate does not list what the agent may do (actions)');
            if (m.agent !== undefined && (typeof m.agent !== 'string' || m.agent.length === 0)) return deny('the agent of the mandate is not valid');
            if (m.agentIdentity !== undefined && (typeof m.agentIdentity !== 'string' || m.agentIdentity.length === 0)) return deny('the agent identity of the mandate is not valid');
            if (m.resources !== undefined && !isStringArray(m.resources)) return deny('the resources of the mandate are not valid');
            let limits: Mandate['limits'];
            if (m.limits !== undefined) {
                const amount = (m.limits as { amount?: { max?: unknown; currency?: unknown } } | null)?.amount;
                if (!m.limits || typeof m.limits !== 'object' || (amount !== undefined && (typeof amount.max !== 'number' || !Number.isFinite(amount.max) || amount.max < 0
                    || (amount.currency !== undefined && typeof amount.currency !== 'string')))) {
                    return deny('the limits of the mandate are not valid');
                }
                limits = amount ? { amount: { max: amount.max as number, ...(amount.currency !== undefined ? { currency: amount.currency as string } : {}) } } : {};
            }

            // Proof of possession, when the credential is tied to a key. `cnf` is read from the signed payload.
            let holderBinding: 'proven' | 'none' = 'none';
            const cnf = payload.cnf as { jwk?: unknown } | undefined;
            if (cnf !== undefined) {
                if (!request.prove) return deny('the credential is tied to a key and the agent has no way to prove it holds it (give mandatePolicy the agentIdentity provider)');
                let key;
                try { key = createPublicKey({ key: cnf.jwk as never, format: 'jwk' }); } catch { return deny('the key the credential is tied to is not readable'); }
                if (key.asymmetricKeyType !== 'ed25519') return deny('only Ed25519 keys are accepted for the proof of possession');
                const at = options.now?.() ?? new Date();
                const aud = options.audience ?? DEFAULT_AUDIENCE;
                const nonce = randomBytes(16).toString('base64url');
                const kb = kbSigningInput({ jwt: token!, disclosures: [], aud, nonce, iat: Math.floor(at.getTime() / 1000) });
                let proof: { kid: string; signature: string };
                try { proof = await request.prove(Buffer.from(kb.signingInput, 'ascii')); } catch (err) { return deny(`the agent could not prove possession of the key: ${err instanceof Error ? err.message : String(err)}`); }
                if (!proof || typeof proof.signature !== 'string') return deny('the agent could not prove possession of the key: it returned no signature');
                const checked = verifyKbJwt(`${kb.signingInput}.${proof.signature}`, { key, jwt: token!, disclosures: [], aud, nonce, now: at });
                if (!checked.ok) return deny(`the agent could not prove possession of the key the credential is tied to: ${checked.reason}`);
                holderBinding = 'proven';
            }

            const mandate: Mandate = {
                id: jti,
                issuer,
                subject: sub,
                ...(m.agent !== undefined ? { agent: m.agent as string } : {}),
                ...(m.agentIdentity !== undefined ? { agentIdentity: m.agentIdentity as string } : {}),
                holderBinding,
                actions: m.actions,
                ...(m.resources !== undefined ? { resources: m.resources as string[] } : {}),
                ...(limits ? { limits } : {}),
                ...(typeof nbf === 'number' ? { validFrom: iso(nbf) } : {}),
                validUntil: iso(exp),
                evidence: credential,
            };

            if (options.isRevoked) {
                let revoked: boolean;
                try { revoked = await options.isRevoked(mandate); } catch { revoked = true; }     // a revocation that cannot be checked is not "not revoked"
                if (revoked) return deny('the mandate is revoked, or its status could not be checked');
            }
            return { ok: true, mandate };
        },
    };
}
