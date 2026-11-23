/**
 * ADAPTER OF AN ASSUMED DALION CREDENTIAL. READ THIS BEFORE USING IT.
 *
 * The real format of the DALION credential is not known yet (SPEC-0043 §6, F3 is blocked on it). This file fixes an ASSUMED shape so
 * the agent, the policy, the audit and the failure cases can be built and tested NOW. Nothing here is DALION's format and nothing
 * here proves compatibility with it. When the real format arrives, this adapter is the ONLY thing that changes: it must keep turning
 * a credential into the same `Mandate`, and the tests in `__tests__/` are the contract the new adapter has to keep passing.
 *
 * WHAT IS KNOWN of DALION: an agent works from a digital identity (like a person) that gives it a power of representation which says
 *   - FOR WHOM it works (the human),
 *   - WHAT it may do (buy),
 *   - ON WHAT (a television),
 *   - up to HOW MUCH (at most 1000 EUR).
 * The credential does NOT say which tools the agent may run. It speaks the language of the DOMAIN (a verb, an object, an amount), not
 * the language of a particular agent's code. Which tool of this agent performs "buy" is declared by the TOOL itself, in the metadata the
 * framework reserves for governance clients (`ToolDefinition.meta`, key `capability`), and what a call is about is read by the operator
 * (`objectOf`). Neither lives in the credential.
 *
 * WHAT IS DEDUCED (DALION is described as compatible with eIDAS 2, and its attestation formats are public): the CONTAINER is an SD-JWT VC
 * (RFC 9901 + the SD-JWT VC draft), one of the two formats of the EUDI wallet. So: `typ` `dc+sd-jwt`; selective Disclosures; holder binding by `cnf`
 * and a Key Binding JWT (`kb+jwt` with `aud`, `nonce`, `sd_hash`); revocation by a Token Status List reference (`status.status_list.{idx, uri}`).
 * Trust in the issuer is a key the operator lists here; a real EUDI relying party would build it from `x5c` and trusted lists.
 *
 * WHAT IS ASSUMED (no public schema of a power-of-representation attestation was found: the ARF defines natural persons representing legal
 * persons and plans "digital power of attorney" as a business-wallet use case, but gives no claims): the PAYLOAD:
 *   - `sub`: the identity of the AGENT (a non-human identity, e.g. `did:dalion:agent:buyer-01`), not of the person;
 *   - `represents`: `{ id }`, the person or entity the agent works for;
 *   - `powers`: a list of `{ action, object?, max?: { value, currency } }`: a verb, optionally the object it applies to, optionally a
 *     limit. No tool names;
 *   - `status`: `{ status_list: { idx, uri } }`, a Token Status List reference;
 *   - `jti`, `nbf`, `exp` (an expiry is required: an open-ended power is not accepted), and a `vct` naming this assumed format.
 *
 * What the adapter decides, failing closed on each: algorithm and `typ` on an allow-list; an issuer the operator trusts, with its key;
 * the signature; the agent identity in `sub` is the one the operator registered for the engine's agent (a credential issued to another
 * agent is useless here); the powers are well formed, with no wildcard and no repeated (verb, object); a limit with no currency is
 * refused; the credential is current; the revocation hook, if it fails, counts as revoked.
 *
 * It answers PER CALL: it takes the verb the called tool performs, finds the power for that verb (and the object the call is about),
 * and returns a `Mandate` that covers THAT tool with THAT power's object and limit. `mandatePolicy` stays unchanged. A tool that
 * declares no capability is never covered.
 */
import { createHash, createPublicKey, randomBytes, verify as edVerify, type KeyObject } from 'node:crypto';
import { kbSigningInput, resolveDisclosures, splitSdJwt, verifyKbJwt } from '../standards/sd-jwt';
import { parseJws, verifyJws, ALGORITHMS, type JwsAlgorithm, type KeyInput } from '@backendkit-labs/agent-mandates';
import type { MandateRequest, MandateVerification, MandateVerifier } from '@backendkit-labs/agent-core';
import { canonicalJson, type IdentityMandate, type IdentityRequest, type Represented } from '../identity/prototype';
import { CAPABILITY_META_KEY } from '../capability';

/** Names the assumed format. Not DALION's. */
export const DALION_ASSUMED_VCT = 'urn:dalion:agent-power-of-representation:assumed:1';

export interface DalionPower {
    /** What may be done, in the credential's vocabulary: `buy`, `sign`, `pay`. Never a tool name. */
    action: string;
    /** What it may be done on: `television`. Absent: any object. */
    object?: string;
    /** The most it may spend on one operation. Absent: no limit. */
    max?: { value: number; currency: string };
}

export interface DalionAdapterOptions {
    /** DALION issuers you trust and their public keys. Nothing is trusted by default. */
    trustedIssuers: Record<string, KeyInput | KeyInput[]>;
    /** The credential this agent holds for this call. `undefined`: there is none, and that is a refusal. */
    credentialFor(request: MandateRequest): string | undefined | Promise<string | undefined>;
    /**
     * The identifier DALION uses for the person the agent acts for, given the application's `userId`. The application's ids and DALION's are
     * different namespaces: this is the operator's mapping. `undefined`: the application has no identifier for that person, a refusal.
     */
    humanIdOf(userId: string): string | undefined;
    /**
     * The public key a person consents with (by their identifier and the key id in the credential), from the operator's trust list.
     * Without it no consent can be verified.
     */
    humanKeyOf?(humanId: string, kid: string): KeyObject | undefined;
    /**
     * Refuse a credential that carries no verified consent of the person it represents. Default true: a power the person did not grant is not a
     * power. `false` accepts it and the audit says `consent: none`.
     */
    requireConsent?: boolean;
    /** The lowest assurance level of the person accepted (`low` < `substantial` < `high`). Without it the level is only recorded. */
    minAssurance?: 'low' | 'substantial' | 'high';
    /**
     * Refuse a credential that is not tied to the agent's key (a bearer credential: whoever holds the string can use it). Default false: it is
     * accepted, and the mandate says `holderBinding: 'none'` so the audit does not pretend a possession was proven.
     */
    requireHolderBinding?: boolean;
    /** What a call acts on, read from its arguments (`args.item` → `television`). Needed for powers that name an object. */
    objectOf?(args: Record<string, unknown>): string | undefined;
    /** Is the credential revoked? Where to look is yours. A hook that throws counts as revoked. */
    isRevoked?(status: { credentialId: string; status?: { uri: string; idx: number } }): boolean | Promise<boolean>;
    /** This verifier's identifier, put in the `aud` of the key binding proof: a proof made for another verifier is not valid here. */
    audience?: string;
    algorithms?: JwsAlgorithm[];
    leewaySeconds?: number;
    now?: () => Date;
}

const TYPES = ['dc+sd-jwt', 'vc+sd-jwt'];
const DEFAULT_AUDIENCE = 'urn:agent-framework:verifier';
const deny = (reason: string): MandateVerification => ({ ok: false, reason });
const iso = (seconds: number): string => new Date(seconds * 1000).toISOString();
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

export function dalionMandateVerifier(options: DalionAdapterOptions): MandateVerifier {
    const algorithms = options.algorithms ?? [...ALGORITHMS];
    const leeway = options.leewaySeconds ?? 0;

    return {
        async verify(request: MandateRequest): Promise<MandateVerification> {
            let credential: string | undefined;
            try { credential = await options.credentialFor(request); } catch (err) { return deny(`the credential could not be read: ${err instanceof Error ? err.message : String(err)}`); }
            if (!credential) return deny('this agent holds no power of representation');

            const parts = splitSdJwt(credential);
            if ('error' in parts) return deny(`the credential is malformed: ${parts.error}`);
            if (parts.kb !== undefined) return deny('a presentation that already carries a key binding proof cannot be reused: the proof is made for each verification');

            const parsed = parseJws(parts.jwt);
            if (!parsed.ok) return deny(`the credential is malformed: ${parsed.reason}`);
            const { header, payload } = parsed.jws;
            if (!algorithms.includes(header.alg as JwsAlgorithm)) return deny(`the algorithm "${header.alg}" is not accepted`);
            if (typeof header.typ !== 'string' || !TYPES.includes(header.typ)) return deny(`the credential type "${String(header.typ)}" is not accepted`);

            const issuer = payload.iss;
            if (!nonEmpty(issuer)) return deny('the credential has no issuer (iss)');
            if (!Object.prototype.hasOwnProperty.call(options.trustedIssuers, issuer)) return deny(`the issuer "${issuer}" is not one you trust`);
            const trusted = options.trustedIssuers[issuer]!;
            const keys = Array.isArray(trusted) ? trusted : [trusted];
            if (!keys.some(k => verifyJws(parsed.jws, k, algorithms))) return deny('the signature does not verify with the keys of that issuer');

            // Signed by who it says. Put the Disclosures back (RFC 9901 refuses the duplicated, the unreferenced and the overwriting ones); from here
            // on the claims are the disclosed ones. `cnf` is read from the signed payload itself: a holder must not be able to hide it.
            const resolved = resolveDisclosures(payload, parts.disclosures);
            if (!resolved.ok) return deny(`the Disclosures of the credential are not valid: ${resolved.reason}`);
            const claims = resolved.claims;

            // Is it for THIS agent, is it current, and is what it says a well formed power.
            if (claims.vct !== DALION_ASSUMED_VCT) return deny(`the credential is not a "${DALION_ASSUMED_VCT}" credential`);
            // The identity of the agent comes from the ENGINE (its identity provider), never from this credential: the credential is presented by
            // the agent, so what it says about who the agent is can only be COMPARED with what the provider says.
            const identity = (request as IdentityRequest).principal.agentIdentity;
            if (!identity) return deny('the engine gives this agent no digital identity, so the credential cannot be matched to it');
            if (claims.sub !== identity.id) return deny('the credential was issued to another agent identity');

            const { jti, nbf, exp, represents, powers, status } = claims;
            if (!nonEmpty(jti)) return deny('the credential has no id (jti)');
            if (typeof exp !== 'number' || !Number.isFinite(exp)) return deny('the credential has no expiry (exp): an open-ended power is not accepted');
            if (nbf !== undefined && (typeof nbf !== 'number' || !Number.isFinite(nbf))) return deny('the start of the credential (nbf) cannot be read');
            const nowSeconds = (options.now?.() ?? new Date()).getTime() / 1000;
            if (nowSeconds > exp + leeway) return deny('the credential has expired');
            if (typeof nbf === 'number' && nowSeconds < nbf - leeway) return deny('the credential is not valid yet');

            if (!represents || typeof represents !== 'object' || Array.isArray(represents) || !nonEmpty((represents as { id?: unknown }).id)) {
                return deny('the credential does not say who the agent works for (represents.id)');
            }
            const rep = represents as { id: string; kind?: unknown; assurance?: unknown; consent?: { kid?: unknown; signature?: unknown } };
            if (rep.kind !== 'person' && rep.kind !== 'legal-entity') return deny('the credential does not say whether it represents a person or a legal entity (represents.kind)');
            if (rep.assurance !== undefined && !nonEmpty(rep.assurance)) return deny('the assurance level of the person is not valid');
            if (!Array.isArray(powers) || powers.length === 0) return deny('the credential grants no powers');

            const granted: DalionPower[] = [];
            const seen = new Set<string>();
            for (const raw of powers as unknown[]) {
                const p = raw as Partial<DalionPower> | null;
                if (!p || typeof p !== 'object' || !nonEmpty(p.action)) return deny('a power has no action');
                if (p.action === '*') return deny('a wildcard power is not accepted: name the action');
                if (p.object !== undefined && !nonEmpty(p.object)) return deny(`the object of "${p.action}" is not valid`);
                if (p.object === '*') return deny('a wildcard object is not accepted: name the object, or leave it out');
                const key = `${p.action}\u0000${p.object ?? ''}`;
                if (seen.has(key)) return deny(`"${p.action}${p.object ? ` ${p.object}` : ''}" appears more than once: its limit would be ambiguous`);
                seen.add(key);
                if (p.max !== undefined) {
                    const max = p.max as { value?: unknown; currency?: unknown };
                    if (typeof max.value !== 'number' || !Number.isFinite(max.value) || max.value < 0) return deny(`the limit of "${p.action}" is not valid`);
                    if (!nonEmpty(max.currency)) return deny(`the limit of "${p.action}" has no currency`);
                }
                granted.push(p as DalionPower);
            }

            // FOR WHOM. The application says who the agent acts for in ITS ids; DALION says in its own. The operator maps one to the other, and
            // the credential has to empower exactly that person: a credential of another person is not "out of scope", it is no power at all.
            const userId = request.principal.userId;
            if (!userId) return deny('the engine does not say who the agent acts for, so the credential cannot be matched to a person');
            const expectedHuman = options.humanIdOf(userId);
            if (!nonEmpty(expectedHuman)) return deny('the application has no identifier for this person in the identity provider');
            if (rep.id !== expectedHuman) return deny('the credential empowers another person than the one the agent acts for');

            if (options.minAssurance) {
                const rank = { low: 0, substantial: 1, high: 2 } as const;
                const got = typeof rep.assurance === 'string' && rep.assurance in rank ? rank[rep.assurance as keyof typeof rank] : -1;
                if (got < rank[options.minAssurance]) return deny(`the person was identified with a lower assurance than the "${options.minAssurance}" this deployment requires`);
            }

            // The person's OWN signature over what the agent may do for them. Without it the issuer could grant powers nobody consented to; with it
            // the issuer cannot widen them afterwards, because the signature covers the powers.
            let consent: 'verified' | 'none' = 'none';
            if (rep.consent !== undefined) {
                const key = typeof rep.consent.kid === 'string' ? options.humanKeyOf?.(rep.id, rep.consent.kid) : undefined;
                if (!key) return deny('the consent of the person cannot be checked: no key of theirs is trusted for it');
                const message = Buffer.from(createHash('sha256').update(canonicalJson({ jti, agent: claims.sub, exp, represents: { id: rep.id, kind: rep.kind }, powers })).digest('hex'), 'hex');
                let ok = false;
                try { ok = typeof rep.consent.signature === 'string' && edVerify(null, message, key, Buffer.from(rep.consent.signature, 'base64url')); } catch { ok = false; }
                if (!ok) return deny('the person did not consent to these powers (their signature does not verify)');
                consent = 'verified';
            } else if (options.requireConsent !== false) {
                return deny('the credential carries no consent of the person it represents');
            }

            // The mandate for THIS call. The verb is what the TOOL declares, never what the credential says about tools. The power
            // is the one for that verb and the object the call is about; with none for the object, the verb's first power is used so
            // the policy refuses with the right reason ("does not cover <object>") instead of a vague one.
            const tool = request.call.tool.name;
            const declared = request.call.tool.meta?.[CAPABILITY_META_KEY];
            const verb = typeof declared === 'string' && declared.length > 0 ? declared : undefined;
            const forVerb = verb === undefined ? [] : granted.filter(p => p.action === verb);
            const object = options.objectOf?.(request.call.args);
            const power = forVerb.find(p => p.object !== undefined && p.object === object)
                ?? forVerb.find(p => p.object === undefined)
                ?? forVerb[0];

            // Proof of possession, as RFC 9901 does it. A credential tied to a key (`cnf`) is only good in the hands of whoever holds that key:
            // the holder presents it with a Key Binding JWT that covers THIS verifier (aud), THIS request (nonce) and THIS presentation (sd_hash).
            // The agent's key is behind the engine's identity provider, so the KB-JWT is built here and the provider signs it.
            let holderBinding: 'proven' | 'none' = 'none';
            const cnf = payload.cnf as { kid?: unknown; jwk?: unknown } | undefined;
            if (cnf !== undefined) {
                const prove = (request as IdentityRequest).prove;
                if (!prove) return deny('the credential is tied to a key and the engine offers no proof of possession');
                let key;
                try { key = createPublicKey({ key: cnf.jwk as never, format: 'jwk' }); } catch { return deny('the key the credential is tied to is not readable'); }
                const now = options.now?.() ?? new Date();
                const aud = options.audience ?? DEFAULT_AUDIENCE;
                const nonce = randomBytes(16).toString('base64url');
                const kb = kbSigningInput({ jwt: parts.jwt, disclosures: parts.disclosures, aud, nonce, iat: Math.floor(now.getTime() / 1000) });
                let proof: { kid: string; signature: string };
                try { proof = await prove(Buffer.from(kb.signingInput, 'ascii')); } catch (err) { return deny(`the agent could not prove possession of the key: ${err instanceof Error ? err.message : String(err)}`); }
                if (typeof cnf.kid === 'string' && proof.kid !== cnf.kid) return deny('the proof was signed by a key other than the one the credential is tied to');
                const checked = verifyKbJwt(`${kb.signingInput}.${proof.signature}`, { key, jwt: parts.jwt, disclosures: parts.disclosures, aud, nonce, now });
                if (!checked.ok) return deny(`the agent could not prove possession of the key the credential is tied to: ${checked.reason}`);
                holderBinding = 'proven';
            } else if (options.requireHolderBinding) {
                return deny('the credential is not tied to a key (a bearer credential) and this deployment requires proof of possession');
            }

            const mandate: IdentityMandate = {
                id: jti,
                issuer,
                subject: userId,   // the application's id for the person: what the framework compares with `principal.userId`
                agent: request.principal.agentId,
                represents: { id: rep.id, kind: rep.kind, ...(typeof rep.assurance === 'string' ? { assurance: rep.assurance } : {}), consent } as Represented,
                agentIdentity: claims.sub as string,   // what the CREDENTIAL says; the layer compares it with what the provider says
                holderBinding,
                actions: power ? [tool] : [],
                ...(power?.object !== undefined ? { resources: [power.object] } : {}),
                ...(power?.max ? { limits: { amount: { max: power.max.value, currency: power.max.currency } } } : {}),
                ...(typeof nbf === 'number' ? { validFrom: iso(nbf) } : {}),
                validUntil: iso(exp),
                evidence: credential,
            };

            if (options.isRevoked) {
                let revoked: boolean;
                try {
                    const list = (status as { status_list?: { uri?: unknown; idx?: unknown } } | undefined)?.status_list;
                    revoked = await options.isRevoked({ credentialId: jti, ...(typeof list?.uri === 'string' && typeof list.idx === 'number' ? { status: { uri: list.uri, idx: list.idx } } : {}) });
                } catch { revoked = true; }
                if (revoked) return deny('the credential is revoked, or its status could not be checked');
            }
            return { ok: true, mandate };
        },
    };
}
