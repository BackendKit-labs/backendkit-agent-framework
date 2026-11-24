/**
 * WHAT IS LEFT OF THE PROTOTYPE OF SPEC-0044 (digital identity of the agent). READ THIS FIRST.
 *
 * `agent-core` does F1, F2 and F3 of the design: an agent carries an identity (`agentIdentity` option), every call is attributed to it, an agent
 * with no identity or no `identity.userId` is denied, every audit event is SIGNED by the identity that executed it, and a mandate is BOUND to the
 * identity (`Mandate.agentIdentity`, compared by `mandateCovers`) with the proof of possession of the key the credential is tied to
 * (`MandateRequest.prove`, given by `mandatePolicy({ agentIdentity })`; `Mandate.holderBinding` in the mandate and the audit).
 * This file used to do the last two; now it only hands the provider to the engine and to the policy. What is left here, marked "CORE:", is what
 * `core` does not do:
 *   - who the agent REPRESENTS as a person or a legal entity, with the assurance of that person and whether they consented (`Mandate.represents`).
 * None of this is a framework API.
 *
 * The design (provider-neutral; no type here names a provider):
 *   - The identity comes from the PROVIDER, never from a credential: a credential is presented by the agent, so trusting what it says
 *     about who the agent is would be circular. A credential's own claim about the agent is COMPARED with the provider's identity.
 */
import type { AgentIdentity, AgentIdentityProvider as CoreIdentityProvider, Mandate, MandateVerification, MandateVerifier, PolicyDecision, ToolCall, ToolPolicy } from '@backendkit-labs/agent-core';

export type { AgentIdentity };

/** The provider of `agent-core`, with `sign` required: the engine signs every audit event with it (F2) and `mandatePolicy` uses it as the proof of possession (F3). */
export interface AgentIdentityProvider extends CoreIdentityProvider {
    /** Signs for the identity of this agent. `signature` is base64url. */
    sign(agentId: string, message: Uint8Array, context?: unknown): Promise<{ kid: string; signature: string; /** What kind of proof this is. `core` records it and does not interpret it. Default `ed25519`. */ format?: string }>;
}

/** CORE: not yet part of `Mandate`. What the adapters add so the audit can say who the agent represented. */
export type IdentityMandate = Mandate & { represents?: Represented };

/**
 * Who the agent works for, as the credential says and as was checked (SPEC-0043/0044: the human is not just a string). CORE: part of `Mandate`
 * and of `AuditMandate`. `consent` says whether the person's own signature over the powers was verified.
 */
export interface Represented { id: string; kind: 'person' | 'legal-entity'; assurance?: string; consent: 'verified' | 'none' }

/** An audit event (F1 attribution, F2 signature and F3 binding are native in `agent-core`). */
export type IdentityAuditEvent = import('@backendkit-labs/agent-core').AuditEvent;

export interface IdentityLayerOptions {
    provider: AgentIdentityProvider;
    /** SPEC-0044 D8: handed to the engine as `requireAgentIdentity`. Default true. `false` is the explicit opt-out, for tests only. */
    require?: boolean;
}

export interface IdentityLayer {
    /** What to spread into the engine so `core` resolves the identity and enforces the requirement: `agentIdentity` and `requireAgentIdentity`. */
    engine: { agentIdentity: AgentIdentityProvider; requireAgentIdentity: boolean };
    /** The provider, for `mandatePolicy({ agentIdentity })`: it is what signs the proof of possession. */
    provider: AgentIdentityProvider;
    /** Wraps the verifier: remembers who the mandate represents, and refuses an agent with no identity when one is required (for a verifier used on its own). */
    verifier(inner: MandateVerifier): MandateVerifier;
    /** Wraps the policy: puts who the agent represents in the audited mandate. */
    policy(inner: ToolPolicy): ToolPolicy;
}

const deny = (reason: string): MandateVerification => ({ ok: false, reason });

export function identityLayer(options: IdentityLayerOptions): IdentityLayer {
    const { provider } = options;
    const require = options.require ?? true;

    // What the verifier learned about one call, for the policy to put in the audited mandate. Keyed by the call object: the policy hands the
    // SAME object to the verifier. CORE: `represents` is part of the mandate and this map disappears.
    const represented = new WeakMap<ToolCall, Represented>();

    return {
        engine: { agentIdentity: provider, requireAgentIdentity: require },
        provider,

        verifier(inner) {
            return {
                async verify(request): Promise<MandateVerification> {
                    // The engine resolves the identity and denies an agent with none before this runs; this is for a verifier used on its own.
                    if (!request.principal.agentIdentity && require) return deny(`the agent "${request.principal.agentId}" has no digital identity`);
                    const verdict = await inner.verify(request);
                    if (!verdict.ok) return verdict;
                    const who = (verdict.mandate as IdentityMandate).represents;
                    if (who) represented.set(request.call, who);
                    return verdict;
                },
            };
        },

        policy(inner) {
            return {
                async decide(principal, call): Promise<PolicyDecision> {
                    const decision = await inner.decide(principal, call);
                    const who = represented.get(call);
                    if (decision.effect === 'allow' && decision.mandate && who) {
                        return { ...decision, mandate: { ...decision.mandate, represents: who } as typeof decision.mandate };
                    }
                    return decision;
                },
            };
        },
    };
}
