/**
 * A SECOND provider, with a DIFFERENT credential format, to show that nothing in the framework is tied to one: a W3C Verifiable Credential
 * carried as a JWT (VC-JWT), the other mainstream container besides SD-JWT VC. Different vocabulary (`credentialSubject`, `actingFor`,
 * `authorizations` with `permission`, `target` and `ceiling`), different revocation entry (`credentialStatus` of a bitstring status list),
 * no selective disclosure. It is translated into the SAME neutral powers and the SAME `Mandate`, and it has to pass the SAME conformance suite.
 *
 * ASSUMED, like the DALION one: the shape of an agent-authorization credential is not standardised; the container (VC Data Model as a JWT) is.
 *
 * Not implemented here, and said so: holder binding. A VC-JWT is presented inside a Verifiable Presentation signed by the holder; this
 * adapter has no presentation step, so its mandates say `holderBinding: 'none'` and `requireHolderBinding` refuses them.
 */
import { parseJws, verifyJws, ALGORITHMS, type JwsAlgorithm, type KeyInput } from '@backendkit-labs/agent-mandates';
import type { MandateRequest, MandateVerification, MandateVerifier } from '@backendkit-labs/agent-core';
import { CAPABILITY_META_KEY } from '../capability';
import type { IdentityMandate, IdentityRequest, Represented } from '../identity/prototype';
import { checkAssurance, checkConsent, checkPowers, consentMessage, selectPower } from './common';
import type { KeyObject } from 'node:crypto';

export const VC_JWT_TYPE = 'AgentAuthorizationCredential';

export interface VcJwtAdapterOptions {
    trustedIssuers: Record<string, KeyInput | KeyInput[]>;
    credentialFor(request: MandateRequest): string | undefined | Promise<string | undefined>;
    humanIdOf(userId: string): string | undefined;
    humanKeyOf?(humanId: string, kid: string): KeyObject | undefined;
    requireConsent?: boolean;
    minAssurance?: 'low' | 'substantial' | 'high';
    requireHolderBinding?: boolean;
    objectOf?(args: Record<string, unknown>): string | undefined;
    isRevoked?(status: { credentialId: string; status?: { uri: string; idx: number } }): boolean | Promise<boolean>;
    algorithms?: JwsAlgorithm[];
    now?: () => Date;
}

const deny = (reason: string): MandateVerification => ({ ok: false, reason });
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const iso = (seconds: number): string => new Date(seconds * 1000).toISOString();

const AUTH_KEYS = ['permission', 'target', 'ceiling'];

export function vcJwtMandateVerifier(options: VcJwtAdapterOptions): MandateVerifier {
    const algorithms = options.algorithms ?? [...ALGORITHMS];
    return {
        async verify(request: MandateRequest): Promise<MandateVerification> {
            let credential: string | undefined;
            try { credential = await options.credentialFor(request); } catch (err) { return deny(`the credential could not be read: ${err instanceof Error ? err.message : String(err)}`); }
            if (!credential) return deny('this agent holds no power of representation');

            const parsed = parseJws(credential);
            if (!parsed.ok) return deny(`the credential is malformed: ${parsed.reason}`);
            const { header, payload } = parsed.jws;
            if (!algorithms.includes(header.alg as JwsAlgorithm)) return deny(`the algorithm "${header.alg}" is not accepted`);
            if (header.typ !== 'JWT' && header.typ !== 'vc+jwt') return deny(`the credential type "${String(header.typ)}" is not accepted`);

            const issuer = payload.iss;
            if (!nonEmpty(issuer)) return deny('the credential has no issuer (iss)');
            if (!Object.prototype.hasOwnProperty.call(options.trustedIssuers, issuer)) return deny(`the issuer "${issuer}" is not one you trust`);
            const trusted = options.trustedIssuers[issuer]!;
            if (!(Array.isArray(trusted) ? trusted : [trusted]).some(k => verifyJws(parsed.jws, k, algorithms))) return deny('the signature does not verify with the keys of that issuer');

            const vc = payload.vc;
            if (!isObject(vc) || !Array.isArray(vc.type) || !vc.type.includes(VC_JWT_TYPE)) return deny(`the credential is not a "${VC_JWT_TYPE}" credential`);
            const subject = vc.credentialSubject;
            if (!isObject(subject)) return deny('the credential has no credentialSubject');

            // The agent's identity comes from the ENGINE; the credential's own claim is only compared.
            const identity = (request as IdentityRequest).principal.agentIdentity;
            if (!identity) return deny('the engine gives this agent no digital identity, so the credential cannot be matched to it');
            if (subject.id !== identity.id) return deny('the credential was issued to another agent identity');

            const { jti, nbf, exp } = payload;
            if (!nonEmpty(jti)) return deny('the credential has no id (jti)');
            if (typeof exp !== 'number' || !Number.isFinite(exp)) return deny('the credential has no expiry (exp): an open-ended power is not accepted');
            if (nbf !== undefined && (typeof nbf !== 'number' || !Number.isFinite(nbf))) return deny('the start of the credential (nbf) cannot be read');
            const nowSeconds = (options.now?.() ?? new Date()).getTime() / 1000;
            if (nowSeconds > exp) return deny('the credential has expired');
            if (typeof nbf === 'number' && nowSeconds < nbf) return deny('the credential is not valid yet');

            // FOR WHOM: this format says `actingFor` with a `type` of Person or Organization; the neutral shape says `kind`.
            const acting = subject.actingFor;
            if (!isObject(acting) || !nonEmpty(acting.id)) return deny('the credential does not say who the agent works for (actingFor.id)');
            const kind = acting.type === 'Person' ? 'person' : acting.type === 'Organization' ? 'legal-entity' : undefined;
            if (!kind) return deny('the credential does not say whether it represents a person or a legal entity (actingFor.type)');
            const userId = request.principal.userId;
            if (!userId) return deny('the engine does not say who the agent acts for, so the credential cannot be matched to a person');
            const expectedHuman = options.humanIdOf(userId);
            if (!nonEmpty(expectedHuman)) return deny('the application has no identifier for this person in the identity provider');
            if (acting.id !== expectedHuman) return deny('the credential empowers another person than the one the agent acts for');
            const lowAssurance = checkAssurance(options.minAssurance, acting.assurance);
            if (lowAssurance) return deny(lowAssurance);

            // Translate this format's powers into the neutral shape; what has no place in it is a restriction and the credential is refused.
            const authorizations = subject.authorizations;
            if (!Array.isArray(authorizations)) return deny('the credential grants no powers');
            const entries = authorizations.map((raw: unknown) => {
                if (!isObject(raw)) return { power: null, extraKeys: [] as string[] };
                const ceiling = isObject(raw.ceiling) ? raw.ceiling : undefined;
                const extraKeys = [
                    ...Object.keys(raw).filter(k => !AUTH_KEYS.includes(k)),
                    ...(ceiling ? Object.keys(ceiling).filter(k => !['amount', 'currency'].includes(k)).map(k => `ceiling.${k}`) : []),
                ];
                return {
                    power: { action: raw.permission, ...(raw.target !== undefined ? { object: raw.target } : {}), ...(ceiling ? { max: { value: ceiling.amount, currency: ceiling.currency } } : {}) },
                    extraKeys,
                };
            });
            const checked = checkPowers(entries);
            if (!checked.ok) return deny(checked.reason);

            const rep = { id: acting.id, kind };
            const consented = checkConsent({
                consent: isObject(acting.consent) ? acting.consent : undefined,
                keyOf: (kid) => options.humanKeyOf?.(rep.id, kid),
                require: options.requireConsent !== false,
                message: consentMessage({ jti, agent: subject.id, exp, represents: rep, powers: checked.powers }),
            });
            if (!consented.ok) return deny(consented.reason);

            if (options.requireHolderBinding) return deny('this format has no key binding in this adapter and this deployment requires proof of possession');

            const declared = request.call.tool.meta?.[CAPABILITY_META_KEY];
            const verb = typeof declared === 'string' && declared.length > 0 ? declared : undefined;
            const power = selectPower(checked.powers, verb, options.objectOf?.(request.call.args));

            if (options.isRevoked) {
                let revoked: boolean;
                try {
                    const entry = isObject(vc.credentialStatus) ? vc.credentialStatus : undefined;
                    const idx = entry && typeof entry.statusListIndex === 'string' ? Number(entry.statusListIndex) : undefined;
                    revoked = await options.isRevoked({
                        credentialId: jti,
                        ...(entry && typeof entry.statusListCredential === 'string' && idx !== undefined && Number.isInteger(idx) ? { status: { uri: entry.statusListCredential, idx } } : {}),
                    });
                } catch { revoked = true; }
                if (revoked) return deny('the credential is revoked, or its status could not be checked');
            }

            const mandate: IdentityMandate = {
                id: jti,
                issuer,
                subject: userId,
                agent: request.principal.agentId,
                represents: { id: rep.id, kind, ...(typeof acting.assurance === 'string' ? { assurance: acting.assurance } : {}), consent: consented.consent } as Represented,
                agentIdentity: subject.id as string,
                holderBinding: 'none',
                actions: power ? [request.call.tool.name] : [],
                ...(power?.object !== undefined ? { resources: [power.object] } : {}),
                ...(power?.max ? { limits: { amount: { max: power.max.value, currency: power.max.currency } } } : {}),
                ...(typeof nbf === 'number' ? { validFrom: iso(nbf) } : {}),
                validUntil: iso(exp),
                evidence: credential,
            };
            return { ok: true, mandate };
        },
    };
}
