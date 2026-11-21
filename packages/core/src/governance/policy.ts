import type { ApproverKind, PolicyDecision, Principal, ToolCall, ToolPolicy } from './types';

/**
 * The rule the engine applies when no `policy` is configured but there is someone to ask (an `approver` or an
 * `approvals` store) — SPEC-0014 §4, decided by facts the tool declares, never by its name:
 *
 * - `readOnly` → allow.
 * - `destructive` → ask, and only a person may approve (`accepts: ['human']`). Never covered by "approve all".
 * - anything else → ask. A tool that declares nothing asks: forgetting a fact asks too much, never too little.
 */
export const defaultToolPolicy: ToolPolicy = {
    decide(_principal: Principal, call: ToolCall): PolicyDecision {
        if (call.tool.readOnly) return { effect: 'allow', reason: 'read-only tool' };
        if (call.tool.destructive) {
            return { effect: 'ask', reason: `"${call.tool.name}" is destructive`, accepts: ['human'] };
        }
        return { effect: 'ask', reason: `"${call.tool.name}" is not declared read-only` };
    },
};

/**
 * Enforces what a tool declares with `alwaysAsk`: a call it flags asks a person, whatever "approve all" says.
 * The engine composes it into the policy path, so opting into `policy`/`approver` never loses a tool's own check.
 */
export const declaredAskPolicy: ToolPolicy = {
    decide(_principal: Principal, call: ToolCall): PolicyDecision {
        const ask = call.tool.alwaysAsk;
        if (!ask || typeof call.args !== 'object' || call.args === null) return { effect: 'allow' };
        return ask(call.args as Record<string, unknown>)
            ? { effect: 'ask', reason: `"${call.tool.name}" is flagged by the tool as needing a person`, accepts: ['human'] }
            : { effect: 'allow' };
    },
};

/** Kinds accepted by both sets; `undefined` means any. An empty result means nobody can approve. */
function intersectAccepts(a: ApproverKind[] | undefined, b: ApproverKind[] | undefined): ApproverKind[] | undefined {
    if (!a) return b;
    if (!b) return a;
    return a.filter(k => b.includes(k));
}

/**
 * Combines decisions of several policies: any `deny` wins; otherwise any `ask` asks (reasons joined, the accepted
 * approver kinds intersected, so the strictest requirement holds); otherwise `allow`. For `allow`, the most
 * restrictive mode wins (`dry_run` over `sandboxed` over `run`). No decisions at all means allow.
 */
export function combineDecisions(decisions: PolicyDecision[]): PolicyDecision {
    const deny = decisions.find(d => d.effect === 'deny');
    if (deny) return deny;

    const asks = decisions.filter((d): d is Extract<PolicyDecision, { effect: 'ask' }> => d.effect === 'ask');
    if (asks.length > 0) {
        let accepts: ApproverKind[] | undefined;
        let constrained = false;
        for (const a of asks) {
            if (a.accepts) { accepts = constrained ? intersectAccepts(accepts, a.accepts) : a.accepts; constrained = true; }
        }
        const approver = asks.find(a => a.approver)?.approver;
        // Roles: whoever approves must hold what EVERY ask asks for, so the strictest holds (the intersection). If no role
        // is left, nobody can approve and the call is denied (fail-closed).
        let roles: string[] | undefined;
        for (const a of asks) {
            const asked = a.approverRoles;
            if (asked && asked.length > 0) roles = roles ? roles.filter(r => asked.includes(r)) : [...asked];
        }
        const reason = asks.map(a => a.reason).join('; ');
        if (roles && roles.length === 0) {
            return { effect: 'deny', reason: `${reason}; the policies ask for approver roles that no one can hold at once` };
        }
        return {
            effect: 'ask',
            reason,
            ...(approver ? { approver } : {}),
            ...(constrained ? { accepts } : {}),
            ...(roles ? { approverRoles: roles } : {}),
        };
    }

    const rank = { run: 0, sandboxed: 1, dry_run: 2 } as const;
    let mode: 'run' | 'sandboxed' | 'dry_run' = 'run';
    const reasons: string[] = [];
    for (const d of decisions) {
        if (d.effect !== 'allow') continue;
        if (d.mode && rank[d.mode] > rank[mode]) mode = d.mode;
        if (d.reason) reasons.push(d.reason);
    }
    return { effect: 'allow', ...(reasons.length ? { reason: reasons.join('; ') } : {}), ...(mode !== 'run' ? { mode } : {}) };
}

/**
 * Rule 3 of SPEC-0014 §6.2 on a decision taken with the approving agent as principal: the agent could do the call
 * itself if it is allowed, or if it would only need an approval an agent may give. A deny, or an ask reserved for
 * other kinds (e.g. people only), means it cannot approve it either.
 */
export function agentCouldPerform(asAgent: PolicyDecision): boolean {
    if (asAgent.effect === 'allow') return true;
    if (asAgent.effect === 'deny') return false;
    return !asAgent.accepts || asAgent.accepts.includes('agent');
}

/**
 * Asks every policy and combines the answers. A policy that throws denies (fail-closed): a decision that cannot
 * be made is not a permission.
 */
export async function evaluatePolicies(policies: ToolPolicy[], principal: Principal, call: ToolCall): Promise<PolicyDecision> {
    const decisions: PolicyDecision[] = [];
    for (const p of policies) {
        try {
            decisions.push(await p.decide(principal, call));
        } catch (err) {
            decisions.push({ effect: 'deny', reason: `policy failed: ${err instanceof Error ? err.message : String(err)}` });
        }
    }
    return combineDecisions(decisions);
}
