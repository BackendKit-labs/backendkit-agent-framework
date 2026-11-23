/**
 * WHAT IS STILL A PROTOTYPE OF SPEC-0044 (digital identity of the agent). READ THIS FIRST.
 *
 * `agent-core` already does F1 and F2 of the design: an agent carries an identity (`agentIdentity` option), every call is attributed to it,
 * an agent with no identity or no `identity.userId` is denied, and every audit event is SIGNED by the identity that executed it, checkable
 * with `verifyAuditChain(path, { agentSignatures })`. This file uses all of that: it hands its provider to the engine (`layer.engine`) and
 * reads `request.principal.agentIdentity`. What is left here is what `core` does not do yet (F3), marked "CORE:":
 *   - the BINDING of a mandate to the identity of the agent, and the proof of possession of the credential's key.
 * None of this is a framework API.
 *
 * The design (provider-neutral; no type here names a provider):
 *   - The identity comes from the PROVIDER, never from a credential: a credential is presented by the agent, so trusting what it says
 *     about who the agent is would be circular. A credential's own claim about the agent is COMPARED with the provider's identity.
 *   - A mandate is bound to the identity, and when the credential is tied to a key, the agent proves it holds that key.
 */
import type { AgentIdentity, AgentIdentityProvider as CoreIdentityProvider, Mandate, MandateRequest, MandateVerification, MandateVerifier, PolicyDecision, ToolCall, ToolPolicy } from '@backendkit-labs/agent-core';

export type { AgentIdentity };

/** The provider of `agent-core`, with `sign` required: the engine signs every audit event with it (F2) and the layer uses it as the proof of possession (F3, still here). */
export interface AgentIdentityProvider extends CoreIdentityProvider {
    /** Signs for the identity of this agent. `signature` is base64url. */
    sign(agentId: string, message: Uint8Array, context?: unknown): Promise<{ kid: string; signature: string; /** What kind of proof this is. `core` records it and does not interpret it. Default `ed25519`. */ format?: string }>;
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

/** An audit event, with what the identity added (F1 attribution and F2 signature are native in `agent-core`). */
export type IdentityAuditEvent = import('@backendkit-labs/agent-core').AuditEvent;

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
}

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
    };
}
