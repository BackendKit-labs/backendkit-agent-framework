/**
 * ADAPTER OF AN ASSUMED DALION CREDENTIAL. READ THIS BEFORE USING IT.
 *
 * The real format of the DALION credential is not known yet (SPEC-0043 §6, F3 is blocked on it). This file fixes an ASSUMED shape,
 * written from what is known of the product, so the agent, the policy, the audit and the failure cases can be built and tested NOW.
 * Nothing here is DALION's format and nothing here proves compatibility with it. When the real format arrives, this adapter is the
 * ONLY thing that changes: it must keep turning a credential into the same `Mandate`, and the tests in `__tests__/` are the contract
 * the new adapter has to keep passing.
 *
 * What is assumed (from the description of DALION: a non-human digital identity per agent, and a power of representation that says
 * for whom the agent works, what it may do and up to what amount, compatible with eIDAS 2):
 *   - an SD-JWT-VC-shaped JWT, signed by DALION (`iss`), type `dc+sd-jwt`;
 *   - `sub`: the identity of the AGENT (a non-human identity, e.g. `did:dalion:agent:buyer-01`), not of the person;
 *   - `represents`: the person or entity the agent works for (`{ id }`);
 *   - `powers`: a list of `{ action, max?: { value, currency }, resources? }`, one per tool, each with ITS OWN amount limit;
 *   - `status`: `{ id }`, what a revocation lookup uses;
 *   - `jti`, `nbf`, `exp` (an expiry is required: an open-ended power is not accepted), and a `vct` that names this assumed format.
 *
 * What the adapter decides, failing closed on each: the algorithm and `typ` are on an allow-list; the issuer is one the operator
 * trusts, with its key; the signature verifies; the agent identity in `sub` is the one the operator registered for the engine's agent
 * (so a credential issued to another agent is useless here); the powers are well formed, with no wildcard and no duplicated action;
 * a limit with no currency is refused; the credential is current; and the revocation hook, if it fails, counts as revoked.
 *
 * Because DALION puts a limit on EACH action, the adapter answers per call: the `Mandate` it returns covers the tool being called,
 * with that tool's limit. `mandatePolicy` stays unchanged.
 */
import { parseJws, verifyJws, ALGORITHMS, type JwsAlgorithm, type KeyInput } from '@backendkit-labs/agent-mandates';
import type { Mandate, MandateRequest, MandateVerification, MandateVerifier } from '@backendkit-labs/agent-core';

/** Names the assumed format. Not DALION's. */
export const DALION_ASSUMED_VCT = 'urn:dalion:agent-power-of-representation:assumed:1';

export interface DalionPower {
    action: string;
    max?: { value: number; currency: string };
    resources?: string[];
}

export interface DalionAdapterOptions {
    /** DALION issuers you trust and their public keys. Nothing is trusted by default. */
    trustedIssuers: Record<string, KeyInput | KeyInput[]>;
    /** The credential this agent holds for this call. `undefined`: there is none, and that is a refusal. */
    credentialFor(request: MandateRequest): string | undefined | Promise<string | undefined>;
    /**
     * The non-human identity DALION gave to the engine's agent (its profile id). The credential must be issued to THIS identity.
     * `undefined`: the agent has none registered, and that is a refusal.
     */
    agentIdentityOf(agentId: string): string | undefined;
    /** Is the credential revoked? Where to look is yours. A hook that throws counts as revoked. */
    isRevoked?(status: { credentialId: string; statusId: string | undefined }): boolean | Promise<boolean>;
    algorithms?: JwsAlgorithm[];
    leewaySeconds?: number;
    now?: () => Date;
}

const TYPES = ['dc+sd-jwt', 'vc+sd-jwt'];
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

            const [token, ...rest] = credential.split('~');
            if (rest.some(part => part.length > 0)) return deny('credentials with selective disclosures or key binding are not supported yet');

            const parsed = parseJws(token!);
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

            // Signed by who it says. Now: is it for THIS agent, is it current, and is what it says a well formed power.
            if (payload.vct !== DALION_ASSUMED_VCT) return deny(`the credential is not a "${DALION_ASSUMED_VCT}" credential`);
            const expected = options.agentIdentityOf(request.principal.agentId);
            if (!nonEmpty(expected)) return deny(`the agent "${request.principal.agentId}" has no DALION identity registered`);
            if (payload.sub !== expected) return deny('the credential was issued to another agent identity');

            const { jti, nbf, exp, represents, powers, status } = payload;
            if (!nonEmpty(jti)) return deny('the credential has no id (jti)');
            if (typeof exp !== 'number' || !Number.isFinite(exp)) return deny('the credential has no expiry (exp): an open-ended power is not accepted');
            if (nbf !== undefined && (typeof nbf !== 'number' || !Number.isFinite(nbf))) return deny('the start of the credential (nbf) cannot be read');
            const nowSeconds = (options.now?.() ?? new Date()).getTime() / 1000;
            if (nowSeconds > exp + leeway) return deny('the credential has expired');
            if (typeof nbf === 'number' && nowSeconds < nbf - leeway) return deny('the credential is not valid yet');

            if (!represents || typeof represents !== 'object' || Array.isArray(represents) || !nonEmpty((represents as { id?: unknown }).id)) {
                return deny('the credential does not say who the agent works for (represents.id)');
            }
            if (!Array.isArray(powers) || powers.length === 0) return deny('the credential grants no powers');

            const granted = new Map<string, DalionPower>();
            for (const raw of powers as unknown[]) {
                const p = raw as Partial<DalionPower> | null;
                if (!p || typeof p !== 'object' || !nonEmpty(p.action)) return deny('a power has no action');
                if (p.action === '*') return deny('a wildcard power is not accepted: name the actions');
                if (granted.has(p.action)) return deny(`the action "${p.action}" appears more than once: its limit would be ambiguous`);
                if (p.max !== undefined) {
                    const max = p.max as { value?: unknown; currency?: unknown };
                    if (typeof max.value !== 'number' || !Number.isFinite(max.value) || max.value < 0) return deny(`the limit of "${p.action}" is not valid`);
                    if (!nonEmpty(max.currency)) return deny(`the limit of "${p.action}" has no currency`);
                }
                if (p.resources !== undefined && (!Array.isArray(p.resources) || p.resources.length === 0 || !p.resources.every(nonEmpty))) {
                    return deny(`the resources of "${p.action}" are not valid`);
                }
                granted.set(p.action, p as DalionPower);
            }

            // The mandate for THIS call: the tool's own power and limit. A tool with no power gets a mandate that does not list it,
            // so the policy sends it to a person instead of treating it as covered.
            const tool = request.call.tool.name;
            const power = granted.get(tool);
            const mandate: Mandate = {
                id: jti,
                issuer,
                subject: (represents as { id: string }).id,
                agent: request.principal.agentId,
                actions: power ? [tool] : [...granted.keys()],
                ...(power?.resources ? { resources: power.resources } : {}),
                ...(power?.max ? { limits: { amount: { max: power.max.value, currency: power.max.currency } } } : {}),
                ...(typeof nbf === 'number' ? { validFrom: iso(nbf) } : {}),
                validUntil: iso(exp),
                evidence: credential,
            };

            if (options.isRevoked) {
                let revoked: boolean;
                try {
                    revoked = await options.isRevoked({ credentialId: jti, statusId: nonEmpty((status as { id?: unknown } | undefined)?.id) ? (status as { id: string }).id : undefined });
                } catch { revoked = true; }
                if (revoked) return deny('the credential is revoked, or its status could not be checked');
            }
            return { ok: true, mandate };
        },
    };
}
