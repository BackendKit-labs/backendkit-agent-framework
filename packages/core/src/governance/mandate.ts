/**
 * Mandates (SPEC-0043): a power of representation an agent acts under. It says, signed by someone with authority, who the agent
 * works for, what it may do, on what and up to how much. The framework does not read any credential format: a
 * {@link MandateVerifier} (yours, a package's, Steward's) turns a credential into a {@link Mandate}, and
 * {@link mandatePolicy} decides, with the facts of the call, whether the mandate covers it.
 *
 * Everything fails closed: no verifier answer, a verifier that throws, a mandate that is expired, not yet valid, for another person
 * or another agent, or one that limits something this policy cannot measure, is not a permission.
 *
 * It does not authenticate anyone: `principal.userId` is what the application says. The mandate says what the agent may do on behalf
 * of that person; that the person is who they claim to be is for whoever issued the credential.
 */
import { createHash } from 'node:crypto';
import type { AuditMandate, PolicyDecision, Principal, ToolCall, ToolPolicy } from './types';

/** What an agent is empowered to do, in terms that do not depend on the format of the credential. */
export interface Mandate {
    /** Unique id of the mandate (the credential's id). */
    id: string;
    /** Who issued it: the party with authority to empower. The verifier decided it is one to trust. */
    issuer: string;
    /** The person or entity that empowers: on whose behalf the agent acts. */
    subject: string;
    /** The agent it is for. Absent: any agent of the holder. */
    agent?: string;
    /** The tools (by name) it covers. `'*'` covers every tool. */
    actions: string[];
    /** What it may be done on (ids, paths, accounts). Absent: no limit on that. Needs `resourceOf` in the policy. */
    resources?: string[];
    /** Hard limits. Each one needs the matching extractor in the policy, or the call is out of scope. */
    limits?: { amount?: { max: number; currency?: string } };
    /** ISO times. Absent `validUntil`: no expiry (the verifier may have decided otherwise). */
    validFrom?: string;
    validUntil?: string;
    /**
     * The digital identity of the agent this mandate was issued to (SPEC-0044 F3). When set, the mandate only covers the agent whose identity,
     * as its provider resolved it, is this one: a credential for another agent is no power here.
     */
    agentIdentity?: string;
    /**
     * Whether the verifier checked that the agent holds the key the credential is tied to (`proven`), or the credential is a bearer one (`none`,
     * the default when absent). Set by the verifier, after calling `request.prove`.
     */
    holderBinding?: 'proven' | 'none';
    /** The original credential, kept so a third party can compare it with the audit trail. Never logged: only its hash. */
    evidence?: string;
}

/** What the verifier is given: the call and who is making it. */
export interface MandateRequest {
    principal: Principal;
    call: ToolCall;
    /**
     * Proof of possession (SPEC-0044 F3): signs `challenge` with the key of the agent's digital identity. A verifier that finds a credential tied to a
     * key builds a challenge for THIS verification (verifier, nonce, credential) and asks the agent to sign it; it then checks the signature with the
     * key of the credential. Present only when `mandatePolicy` was given the identity provider.
     */
    prove?: (challenge: Uint8Array) => Promise<{ kid: string; signature: string }>;
}

export type MandateVerification = { ok: true; mandate: Mandate } | { ok: false; reason: string };

/**
 * Turns whatever credential the application holds for this agent into a verified {@link Mandate}: signature, trusted issuer,
 * validity and revocation are its job. Asynchronous: it may go to a network.
 */
export interface MandateVerifier {
    verify(request: MandateRequest): Promise<MandateVerification>;
}

export interface MandatePolicyOptions {
    verifier: MandateVerifier;
    /** The amount a call spends, read from its arguments. Without it, a mandate that limits the amount covers nothing. */
    amountOf?: (args: Record<string, unknown>) => { value: number; currency?: string } | undefined;
    /** What a call acts on, read from its arguments. Without it, a mandate that limits resources covers nothing. */
    resourceOf?: (args: Record<string, unknown>) => string | undefined;
    /** What happens to a call with a valid mandate that does not cover it. Default `ask` (a person decides). */
    outOfScope?: 'ask' | 'deny';
    /**
     * The identity provider of the engine. With it, a verifier can ask the agent to prove it holds the key a credential is tied to
     * (`request.prove`). Without it no proof can be made and a credential tied to a key is refused by the verifiers that require one.
     */
    agentIdentity?: { sign?: (agentId: string, message: Uint8Array, context: { sessionId: string; tenantId?: string; userId?: string }) => Promise<{ kid: string; signature: string }> | { kid: string; signature: string } };
    /**
     * Refuse a credential that is not tied to the agent's key (a bearer credential). Default false: it is accepted and the audit says
     * `holderBinding: none`, so it does not look like a possession was shown. `true` is the setting for a deployment that wants possession.
     */
    requireHolderBinding?: boolean;
    /** Require that the mandate is for the person the agent acts for (`principal.userId`). Default true. */
    requireSubject?: boolean;
    /** Clock, for tests. */
    now?: () => Date;
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** The part of a mandate that goes to the audit event: who, under what, for whom, never the credential itself. */
export function auditMandate(m: Mandate): AuditMandate {
    return {
        id: m.id,
        issuer: m.issuer,
        subject: m.subject,
        ...(m.agentIdentity !== undefined ? { agentIdentity: m.agentIdentity } : {}),
        holderBinding: m.holderBinding ?? 'none',
        ...(m.validUntil !== undefined ? { validUntil: m.validUntil } : {}),
        ...(m.evidence !== undefined ? { evidenceHash: sha256(m.evidence) } : {}),
    };
}

/**
 * A mandate that names an agent identity is a power of THAT agent: for any other it is not a power at all, so it is not "out of scope" (a person
 * could approve it) but a refusal. `undefined`: the mandate names no identity, or names this one.
 */
function identityBindingProblem(m: Mandate, principal: Principal): string | undefined {
    if (m.agentIdentity === undefined) return undefined;
    if (!principal.agentIdentity) return 'the mandate is bound to an agent identity and this agent has none';
    if (m.agentIdentity !== principal.agentIdentity.id) return 'the mandate is bound to another agent identity';
    return undefined;
}

/** Does the mandate cover this call? The reason is the first thing that does not. */
export function mandateCovers(
    m: Mandate, principal: Principal, call: ToolCall, options: Pick<MandatePolicyOptions, 'amountOf' | 'resourceOf' | 'requireSubject' | 'now'> = {},
): { ok: true } | { ok: false; reason: string } {
    const now = (options.now?.() ?? new Date()).getTime();
    if (m.validFrom !== undefined && !(Date.parse(m.validFrom) <= now)) return { ok: false, reason: 'the mandate is not valid yet, or its start cannot be read' };
    if (m.validUntil !== undefined && !(now <= Date.parse(m.validUntil))) return { ok: false, reason: 'the mandate has expired, or its end cannot be read' };
    if (m.agent !== undefined && m.agent !== principal.agentId) return { ok: false, reason: `the mandate is for agent "${m.agent}", not "${principal.agentId}"` };
    const bound = identityBindingProblem(m, principal);
    if (bound) return { ok: false, reason: bound };
    if (options.requireSubject !== false) {
        if (principal.userId === undefined) return { ok: false, reason: 'the engine does not say who the agent acts for (identity.userId), so the mandate cannot be matched to a person' };
        if (m.subject !== principal.userId) return { ok: false, reason: 'the mandate empowers another person than the one the agent acts for' };
    }
    if (!m.actions.includes('*') && !m.actions.includes(call.tool.name)) return { ok: false, reason: `the mandate does not cover "${call.tool.name}"` };

    if (m.resources !== undefined) {
        const resource = options.resourceOf?.(call.args);
        if (resource === undefined) return { ok: false, reason: 'the mandate limits what the agent may act on and this call does not say what it acts on' };
        if (!m.resources.includes(resource)) return { ok: false, reason: `the mandate does not cover "${resource}"` };
    }

    const limit = m.limits?.amount;
    if (limit !== undefined) {
        const spent = options.amountOf?.(call.args);
        if (spent === undefined) return { ok: false, reason: 'the mandate limits the amount and this call does not say how much it spends' };
        if (!Number.isFinite(spent.value) || spent.value < 0) return { ok: false, reason: 'the amount of the call is not a valid number' };
        if (limit.currency !== undefined && spent.currency !== limit.currency) return { ok: false, reason: `the mandate is in ${limit.currency} and the call in ${spent.currency ?? 'no currency'}` };
        if (spent.value > limit.max) return { ok: false, reason: `the amount ${spent.value} is above the ${limit.max} the mandate allows` };
    }
    return { ok: true };
}

/**
 * The policy that lets an agent act alone inside its mandate. No valid mandate: `deny`. A valid one that covers the call: `allow`,
 * with the mandate in the audit event. A valid one that does not cover it: `ask` (or `deny`, with `outOfScope: 'deny'`).
 *
 * Use it as the engine's `policy`. A policy that asks for the same tool still wins (an `ask` beats an `allow`), so do not combine it
 * with one that asks for what the mandate is meant to cover.
 */
export function mandatePolicy(options: MandatePolicyOptions): ToolPolicy {
    return {
        async decide(principal: Principal, call: ToolCall): Promise<PolicyDecision> {
            let verdict: Awaited<ReturnType<MandateVerifier['verify']>>;
            try {
                const provider = options.agentIdentity;
                const prove: MandateRequest['prove'] | undefined = principal.agentIdentity && provider?.sign
                    ? async (challenge) => provider.sign!(principal.agentId, challenge, { sessionId: principal.sessionId, ...(principal.tenantId ? { tenantId: principal.tenantId } : {}), ...(principal.userId ? { userId: principal.userId } : {}) })
                    : undefined;
                verdict = await options.verifier.verify({ principal, call, ...(prove ? { prove } : {}) });
            } catch (err) {
                return { effect: 'deny', reason: `the mandate verifier failed: ${err instanceof Error ? err.message : String(err)}` };
            }
            if (!verdict || typeof verdict !== 'object' || verdict.ok !== true || !verdict.mandate) {
                const why = verdict && typeof verdict === 'object' && 'reason' in verdict ? String(verdict.reason) : 'no answer';
                return { effect: 'deny', reason: `no valid mandate: ${why}` };
            }
            const notHers = identityBindingProblem(verdict.mandate, principal);
            if (notHers) return { effect: 'deny', reason: `no valid mandate: ${notHers}` };
            if (options.requireHolderBinding && verdict.mandate.holderBinding !== 'proven') {
                return { effect: 'deny', reason: 'no valid mandate: the credential is not tied to the key of the agent (a bearer credential) and this deployment requires proof of possession' };
            }
            const covered = mandateCovers(verdict.mandate, principal, call, options);
            if (covered.ok) return { effect: 'allow', reason: `covered by mandate ${verdict.mandate.id}`, mandate: auditMandate(verdict.mandate) };
            return options.outOfScope === 'deny'
                ? { effect: 'deny', reason: `outside the mandate: ${covered.reason}` }
                : { effect: 'ask', reason: `outside the mandate: ${covered.reason}`, accepts: ['human'] };
        },
    };
}
