/**
 * PROTOTYPE OF SPEC-0044 (digital identity of the agent). READ THIS FIRST.
 *
 * `agent-core` has no place for the identity of an agent yet: the `Principal` carries the profile id, the audit event has no identity
 * and nothing signs an action. SPEC-0044 proposes to add them to the framework. This file builds that DESIGN here, in the example, with
 * the smallest shims around what `agent-core` offers today, to test the design before touching the framework. Every shim is marked
 * "CORE:" with the change in `agent-core` that makes it disappear. None of this is a framework API.
 *
 * The design (provider-neutral; no type here names a provider):
 *   - `AgentIdentityProvider`: gives each agent its identity (`resolve`) and signs for it (`sign`, asynchronous: a key may sit in a KMS,
 *     an HSM or a provider's custody). The framework never has to hold a private key.
 *   - The identity comes from the PROVIDER, never from a credential: a credential is presented by the agent, so trusting what it says
 *     about who the agent is would be circular. A credential's own claim about the agent is COMPARED with the provider's identity.
 *   - Every action is attributed to that identity in the audit, and signed by it.
 *   - A mandate is bound to the identity, and when the credential is tied to a key, the agent proves it holds that key.
 *   - `require` (SPEC-0044 D8, D11): an agent with no identity, or that does not say on whose behalf it acts, is denied, by default from the first
 *     version (no transition period). Switch-off is an explicit opt-out for tests.
 *   - The proof is OPAQUE (D12): `sign` says its `format` and the framework records it. Ed25519 is checked here; any other format (a qualified seal,
 *     a trusted timestamp...) is checked by a verifier the operator registers. Nothing in this file knows any legal framework.
 */
import { createHash, createPublicKey, verify as edVerify, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson } from '@backendkit-labs/agent-mandates';
import type { AuditEvent, AuditSink, Mandate, MandateRequest, MandateVerification, MandateVerifier, PolicyDecision, ToolCall, ToolPolicy } from '@backendkit-labs/agent-core';

/** SPEC-0044 D1. `id` is opaque to the framework: a DID, a URN, an internal id. */
export interface AgentIdentity {
    id: string;
    issuer?: string;
    /** The key this identity signs with. */
    kid?: string;
}

/** SPEC-0044 D2. */
export interface AgentIdentityProvider {
    /** The identity of this agent (its profile id), or `undefined` if the provider has none for it. */
    resolve(agentId: string): Promise<AgentIdentity | undefined>;
    /** Signs for the identity of this agent. Asynchronous on purpose. `signature` is base64url. */
    sign(agentId: string, message: Uint8Array): Promise<{ kid: string; signature: string; /** What kind of proof this is. `core` records it and does not interpret it. Default `ed25519`. */ format?: string }>;
}

/**
 * CORE: `Principal.agentIdentity` (SPEC-0044 D3) and `MandateRequest.prove` (D6). Here the request is widened and the layer fills the fields.
 */
export interface IdentityPrincipal { agentIdentity?: AgentIdentity }
export type ProofOfPossession = (challenge: Uint8Array) => Promise<{ kid: string; signature: string }>;
export interface IdentityRequest extends MandateRequest { principal: MandateRequest['principal'] & IdentityPrincipal; prove?: ProofOfPossession }

/** CORE: `Mandate.agentIdentity` and `Mandate.holderBinding` (SPEC-0044 D5, D6). */
export type IdentityMandate = Mandate & { agentIdentity?: string; holderBinding?: 'proven' | 'none'; represents?: Represented };

/**
 * Who the agent works for, as the credential says and as was checked (SPEC-0043/0044: the human is not just a string). CORE: part of `Mandate`
 * and of `AuditMandate`. `consent` says whether the person's own signature over the powers was verified.
 */
export interface Represented { id: string; kind: 'person' | 'legal-entity'; assurance?: string; consent: 'verified' | 'none' }

/** What the layer leaves in the audit, next to the event (CORE: `AuditEvent.agentIdentity`, `AuditMandate.agentIdentity/holderBinding`, D4). */
export interface AgentSignature { kid: string; signature: string; format?: string }
export type IdentityAuditEvent = AuditEvent & {
    agentIdentity?: AgentIdentity;
    /** Present when the agent had no identity: the log says so instead of staying silent (SPEC-0044 F4). */
    agentIdentityMissing?: true;
    agentSignature?: AgentSignature;
    /** The identity could not sign this event (custody down). The event is recorded anyway, unsigned and marked: a lost record is worse than an unsigned one. */
    agentSignatureFailed?: true;
};

export interface IdentityLayerOptions {
    provider: AgentIdentityProvider;
    /** SPEC-0044 D8: an agent with no identity is denied. Default true, from the first version (SPEC-0044: no transition period). `false` is the explicit opt-out, for tests only. */
    require?: boolean;
    /** Called once per agent without identity when `require` is off (CORE: a warning on the transport). */
    warn?: (message: string) => void;
}

export interface IdentityLayer {
    /** Wraps the verifier: resolves the identity, hands the proof function down, and binds the mandate to the identity. */
    verifier(inner: MandateVerifier): MandateVerifier;
    /** Wraps the policy: refuses any call of an agent with no identity when required, and puts the identity facts in the audited mandate. */
    policy(inner: ToolPolicy): ToolPolicy;
    /** Wraps the audit sink: attributes each event to the identity and signs it with that identity's key. */
    audit(inner: AuditSink): AuditSink;
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

const deny = (reason: string): MandateVerification => ({ ok: false, reason });

export function identityLayer(options: IdentityLayerOptions): IdentityLayer {
    const { provider } = options;
    const require = options.require ?? true;
    const warned = new Set<string>();

    /** Fail closed: a provider that throws is "no identity, and a failure", not "no identity needed". */
    async function resolveSafe(agentId: string): Promise<{ identity?: AgentIdentity; error?: string }> {
        try { return { identity: await provider.resolve(agentId) }; }
        catch (err) { return { error: `the identity provider failed: ${err instanceof Error ? err.message : String(err)}` }; }
    }

    // What the verifier learned about one call, for the policy to put in the audited mandate. Keyed by the call object: the policy hands the
    // SAME object to the verifier. CORE: the mandate itself carries these (D5, D6) and this map disappears.
    const facts = new WeakMap<ToolCall, { agentIdentity?: string; holderBinding: 'proven' | 'none'; represents?: Represented }>();

    return {
        verifier(inner) {
            return {
                async verify(request: MandateRequest): Promise<MandateVerification> {
                    const agentId = request.principal.agentId;
                    const { identity, error } = await resolveSafe(agentId);
                    if (error) return deny(error);
                    if (!identity && require) return deny(`the agent "${agentId}" has no digital identity`);

                    const enriched: IdentityRequest = {
                        ...request,
                        principal: { ...request.principal, ...(identity ? { agentIdentity: identity } : {}) },
                        ...(identity ? { prove: (challenge) => provider.sign(agentId, challenge) } : {}),
                    };
                    const verdict = await inner.verify(enriched);
                    if (!verdict.ok) return verdict;

                    // CORE: `mandateCovers` does this comparison (D5).
                    const mandate = verdict.mandate as IdentityMandate;
                    if (mandate.agentIdentity !== undefined) {
                        if (!identity) return deny('the mandate is bound to an agent identity and this agent has none');
                        if (mandate.agentIdentity !== identity.id) return deny('the mandate is bound to another agent identity');
                    }
                    facts.set(request.call, {
                        ...(mandate.agentIdentity !== undefined ? { agentIdentity: mandate.agentIdentity } : {}),
                        holderBinding: mandate.holderBinding ?? 'none',
                        ...(mandate.represents ? { represents: mandate.represents } : {}),
                    });
                    return verdict;
                },
            };
        },

        policy(inner) {
            return {
                async decide(principal, call): Promise<PolicyDecision> {
                    if (require) {
                        const { identity, error } = await resolveSafe(principal.agentId);
                        if (error) return { effect: 'deny', reason: error };
                        if (!identity) return { effect: 'deny', reason: `the agent "${principal.agentId}" has no digital identity` };
                        // The other half of an accountable agent: FOR WHOM it acts. An agent acting for nobody is refused (D11).
                        if (!principal.userId) return { effect: 'deny', reason: `the engine does not say who the agent acts for: an agent must carry the party it acts on behalf of (identity.userId)` };
                    } else if (!warned.has(principal.agentId)) {
                        const { identity } = await resolveSafe(principal.agentId);
                        if (!identity) { warned.add(principal.agentId); options.warn?.(`the agent "${principal.agentId}" runs with no digital identity; it will be refused once identity is required`); }
                    }
                    const decision = await inner.decide(principal, call);
                    const learned = facts.get(call);
                    if (decision.effect === 'allow' && decision.mandate && learned) {
                        return { ...decision, mandate: { ...decision.mandate, ...learned } as typeof decision.mandate };
                    }
                    return decision;
                },
            };
        },

        audit(inner) {
            return {
                async write(event: AuditEvent): Promise<void> {
                    const agentId = event.principal.agentId;
                    const { identity } = await resolveSafe(agentId);
                    if (!identity) {
                        await inner.write({ ...event, agentIdentityMissing: true } as IdentityAuditEvent);
                        return;
                    }
                    const attributed: IdentityAuditEvent = { ...event, agentIdentity: identity };
                    // What the identity signs: the whole attributed event, canonically. CORE: signed by `core` itself (SPEC-0044 D4).
                    const message = Buffer.from(sha256(canonicalJson(attributed)), 'hex');
                    let signed: { kid: string; signature: string; format?: string } | undefined;
                    try { signed = await provider.sign(agentId, message); } catch { signed = undefined; }
                    // The action already happened. If the identity cannot sign, the event is still written, marked as unsigned: the trail is not
                    // lost, and `verifyAgentSignatures` reports it so it cannot pass for a signed one.
                    await inner.write((signed ? { ...attributed, agentSignature: { kid: signed.kid, signature: signed.signature, format: signed.format ?? 'ed25519' } } : { ...attributed, agentSignatureFailed: true }) as IdentityAuditEvent);
                },
            };
        },
    };
}

export interface SignatureCheck { ok: boolean; checked: number; failures: Array<{ seq: number; reason: string }> }

/**
 * Checks, event by event, that each one is signed by the identity it names. `keyOf` gives the PUBLIC key of a `kid` (from the provider or the
 * operator's trust list). CORE: `verifyAuditChain` does this (SPEC-0044 F2). This is independent of the hash chain: an event edited and
 * re-chained still fails here, because the signature covers the content.
 */
/** Checks a proof of a format `core` does not know. Registered by the operator. `message` is what was signed. */
export type FormatVerifier = (message: Buffer, proof: AgentSignature) => boolean;

export function verifyAgentSignatures(logPath: string, keyOf: (kid: string) => KeyObject | undefined, formats: Record<string, FormatVerifier> = {}): SignatureCheck {
    const failures: SignatureCheck['failures'] = [];
    let checked = 0;
    const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
        const entry = JSON.parse(line) as { seq: number; event: IdentityAuditEvent };
        const { agentSignature, ...rest } = entry.event;
        if (!agentSignature) {
            if (entry.event.agentSignatureFailed) { failures.push({ seq: entry.seq, reason: 'the identity could not sign this event' }); continue; }
            if (!entry.event.agentIdentityMissing) failures.push({ seq: entry.seq, reason: 'the event is neither signed nor marked as having no identity' });
            continue;
        }
        checked++;
        if (!entry.event.agentIdentity) { failures.push({ seq: entry.seq, reason: 'signed, but names no identity' }); continue; }
        if (entry.event.agentIdentity.kid !== undefined && entry.event.agentIdentity.kid !== agentSignature.kid) {
            failures.push({ seq: entry.seq, reason: 'signed by a key that is not the one of the identity it names' });
            continue;
        }
        const message = Buffer.from(sha256(canonicalJson(rest)), 'hex');
        const format = agentSignature.format ?? 'ed25519';
        if (format !== 'ed25519') {
            const verifyFormat = Object.prototype.hasOwnProperty.call(formats, format) ? formats[format] : undefined;
            if (!verifyFormat) { failures.push({ seq: entry.seq, reason: `no verifier is registered for the proof format "${format}"` }); continue; }
            let good = false;
            try { good = verifyFormat(message, agentSignature); } catch { good = false; }
            if (!good) failures.push({ seq: entry.seq, reason: 'the signature does not verify' });
            continue;
        }
        const key = keyOf(agentSignature.kid);
        if (!key) { failures.push({ seq: entry.seq, reason: `no public key for "${agentSignature.kid}"` }); continue; }
        let ok = false;
        try { ok = edVerify(null, message, key.type === 'private' ? createPublicKey(key) : key, Buffer.from(agentSignature.signature, 'base64url')); } catch { ok = false; }
        if (!ok) failures.push({ seq: entry.seq, reason: 'the signature does not verify' });
    }
    return { ok: failures.length === 0, checked, failures };
}
