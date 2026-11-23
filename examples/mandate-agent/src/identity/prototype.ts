/**
 * WHAT IS STILL A PROTOTYPE OF SPEC-0044 (digital identity of the agent). READ THIS FIRST.
 *
 * `agent-core` 0.49 already does the first part of the design (F1): an agent carries an identity (`agentIdentity` option, resolved by an
 * `AgentIdentityProvider`), every call is attributed to it in the audit, and an agent with no identity or no `identity.userId` is denied.
 * This file no longer resolves identities or enforces the requirement: it uses `request.principal.agentIdentity` and `event.agentIdentity`,
 * which the engine fills. What is left here is what `core` does not do yet, each shim marked "CORE:" with the change that makes it disappear:
 *   - the BINDING of a mandate to the identity of the agent, and the proof of possession of the credential's key (F3);
 *   - the SIGNATURE of every audit event by the identity that executed it, and its verification (F2).
 * None of this is a framework API.
 *
 * The design (provider-neutral; no type here names a provider):
 *   - The identity comes from the PROVIDER, never from a credential: a credential is presented by the agent, so trusting what it says
 *     about who the agent is would be circular. A credential's own claim about the agent is COMPARED with the provider's identity.
 *   - A mandate is bound to the identity, and when the credential is tied to a key, the agent proves it holds that key.
 *   - Every action is signed by the identity that executed it. The proof is OPAQUE (D12): `sign` says its `format` and the framework records
 *     it. Ed25519 is checked here; any other format is checked by a verifier the operator registers. Nothing here knows any legal framework.
 */
import { createHash, createPublicKey, verify as edVerify, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson } from '@backendkit-labs/agent-mandates';
import type { AgentIdentity, AgentIdentityProvider as CoreIdentityProvider, AuditEvent, AuditSink, Mandate, MandateRequest, MandateVerification, MandateVerifier, PolicyDecision, ToolCall, ToolPolicy } from '@backendkit-labs/agent-core';

export type { AgentIdentity };

/** The provider of `agent-core` (it resolves identities) plus what is still a prototype here: it signs for them (SPEC-0044 F2). Asynchronous on purpose: a key may sit in a KMS or an HSM. */
export interface AgentIdentityProvider extends CoreIdentityProvider {
    /** Signs for the identity of this agent. `signature` is base64url. */
    sign(agentId: string, message: Uint8Array): Promise<{ kid: string; signature: string; /** What kind of proof this is. `core` records it and does not interpret it. Default `ed25519`. */ format?: string }>;
}

/** CORE: `MandateRequest.prove` (SPEC-0044 D6). The engine already fills `principal.agentIdentity`; the layer fills this. */
export type ProofOfPossession = (challenge: Uint8Array) => Promise<{ kid: string; signature: string }>;
export interface IdentityRequest extends MandateRequest { prove?: ProofOfPossession }

/** CORE: `Mandate.agentIdentity` and `Mandate.holderBinding` (SPEC-0044 D5, D6). */
export type IdentityMandate = Mandate & { agentIdentity?: string; holderBinding?: 'proven' | 'none'; represents?: Represented };

/**
 * Who the agent works for, as the credential says and as was checked (SPEC-0043/0044: the human is not just a string). CORE: part of `Mandate`
 * and of `AuditMandate`. `consent` says whether the person's own signature over the powers was verified.
 */
export interface Represented { id: string; kind: 'person' | 'legal-entity'; assurance?: string; consent: 'verified' | 'none' }

/** What the layer leaves in the audit, next to the event (CORE: `AuditMandate.agentIdentity/holderBinding`, and the signature of F2). The attribution itself is native. */
export interface AgentSignature { kid: string; signature: string; format?: string }
export type IdentityAuditEvent = AuditEvent & {
    agentSignature?: AgentSignature;
    /** The identity could not sign this event (custody down). The event is recorded anyway, unsigned and marked: a lost record is worse than an unsigned one. */
    agentSignatureFailed?: true;
};

export interface IdentityLayerOptions {
    provider: AgentIdentityProvider;
    /** SPEC-0044 D8: handed to the engine as `requireAgentIdentity`. Default true. `false` is the explicit opt-out, for tests only. */
    require?: boolean;
}

export interface IdentityLayer {
    /** What to spread into the engine so `core` resolves the identity and enforces the requirement: `agentIdentity` and `requireAgentIdentity`. */
    engine: { agentIdentity: AgentIdentityProvider; requireAgentIdentity: boolean };
    /** Wraps the verifier: hands the proof function down, and binds the mandate to the identity the engine resolved. */
    verifier(inner: MandateVerifier): MandateVerifier;
    /** Wraps the policy: puts the identity facts in the audited mandate. */
    policy(inner: ToolPolicy): ToolPolicy;
    /** Wraps the audit sink: signs each event (already attributed by the engine) with that identity's key. */
    audit(inner: AuditSink): AuditSink;
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

const deny = (reason: string): MandateVerification => ({ ok: false, reason });

export function identityLayer(options: IdentityLayerOptions): IdentityLayer {
    const { provider } = options;
    const require = options.require ?? true;

    // What the verifier learned about one call, for the policy to put in the audited mandate. Keyed by the call object: the policy hands the
    // SAME object to the verifier. CORE: the mandate itself carries these (D5, D6) and this map disappears.
    const facts = new WeakMap<ToolCall, { agentIdentity?: string; holderBinding: 'proven' | 'none'; represents?: Represented }>();

    return {
        engine: { agentIdentity: provider, requireAgentIdentity: require },

        verifier(inner) {
            return {
                async verify(request: MandateRequest): Promise<MandateVerification> {
                    const agentId = request.principal.agentId;
                    // The engine resolves the identity and denies an agent with none before this runs; this is for a verifier used on its own.
                    const identity = request.principal.agentIdentity;
                    if (!identity && require) return deny(`the agent "${agentId}" has no digital identity`);

                    const enriched: IdentityRequest = {
                        ...request,
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
                    // The engine attributes the event (`agentIdentity`) or marks it as having none (`agentIdentityMissing`).
                    if (!event.agentIdentity) { await inner.write(event); return; }
                    const agentId = event.principal.agentId;
                    // What the identity signs: the whole attributed event, canonically. CORE: signed by `core` itself (SPEC-0044 F2).
                    const message = Buffer.from(sha256(canonicalJson(event)), 'hex');
                    let signed: { kid: string; signature: string; format?: string } | undefined;
                    try { signed = await provider.sign(agentId, message); } catch { signed = undefined; }
                    // The action already happened. If the identity cannot sign, the event is still written, marked as unsigned: the trail is not
                    // lost, and `verifyAgentSignatures` reports it so it cannot pass for a signed one.
                    await inner.write((signed ? { ...event, agentSignature: signed } : { ...event, agentSignatureFailed: true }) as IdentityAuditEvent);
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
