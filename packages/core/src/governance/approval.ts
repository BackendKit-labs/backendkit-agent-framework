import type { ToolApprovalDecision } from '../types';
import type {
    ApprovalOutcome, ApprovalRequest, Approver, ApproverAuthority, ApproverDirectory, ApproverKind, ApproverRef, Principal,
} from './types';

/**
 * Does the approver hold what the `ask` requires (SPEC-0041)? Nothing is required when the `ask` has no `approverRoles`.
 * Otherwise the roles come from the application's `directory`, never from what the caller says in `by`, and it fails
 * closed: no directory, an id it does not know, a directory that throws, another tenant, or none of the roles is a
 * problem. When it passes, `authority` says what was recognized, for the audit event.
 */
export async function approverAuthority(
    by: ApproverRef,
    request: { principal: Principal; approverRoles?: string[] },
    directory?: ApproverDirectory,
): Promise<{ problem: string } | { authority?: ApproverAuthority }> {
    const required = request.approverRoles;
    if (!required || required.length === 0) return {};
    if (!directory) return { problem: `this action needs approval by someone with the role ${required.join(' or ')} and no approver directory is configured` };
    let profile;
    try {
        profile = await directory.describe(by);
    } catch (err) {
        return { problem: `the approver directory failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!profile) return { problem: `approver "${by.id}" is not known to the approver directory` };
    const tenant = request.principal.tenantId;
    if (tenant !== undefined && profile.tenantId !== undefined && profile.tenantId !== tenant) {
        return { problem: `approver "${by.id}" belongs to another tenant than the request` };
    }
    const matched = required.find(r => profile.roles.includes(r));
    if (!matched) return { problem: `approver "${by.id}" does not have the role ${required.join(' or ')}` };
    return { authority: { roles: [...profile.roles], ...(profile.tenantId !== undefined ? { tenantId: profile.tenantId } : {}), matched } };
}

/**
 * Checks an approver's answer against the rules of SPEC-0014 §6.2 before the engine accepts it. Returns the reason
 * it is not valid, or undefined when it is. An invalid approval is treated as a rejection.
 *
 * 1. The approver's kind is one the decision accepts.
 * 2. Nobody approves their own request: not the agent that asked, nor any agent in its delegation chain.
 * 3. An agent approves only what it could do itself (`canAgentAct`, evaluated by the engine with that agent as
 *    principal over the same call).
 * 5. With `forbidSelfApproval` (SPEC-0041 F2): the person on whose behalf the agent acts (`principal.userId`) does not
 *    approve it either, whatever the kind of approver. Four eyes: whoever asks and whoever approves are two people.
 *
 * Rule 4 (every approval audited with its approver in full) is the engine's job when it writes the event.
 */
export async function approvalProblem(
    outcome: ApprovalOutcome,
    request: { principal: Principal; accepts?: ApproverKind[]; forbidSelfApproval?: boolean },
    canAgentAct: (approver: ApproverRef) => Promise<boolean>,
): Promise<string | undefined> {
    const by = outcome.by;
    if (!by || typeof by.id !== 'string' || !by.id || !['human', 'agent', 'service'].includes(by.kind)) {
        return 'the approval does not say who approved it';
    }
    if (request.accepts && !request.accepts.includes(by.kind)) {
        return `this action needs approval by ${request.accepts.join(' or ')}, not by ${by.kind} "${by.id}"`;
    }
    const { principal } = request;
    if (by.kind !== 'human' && (by.id === principal.agentId || principal.chain.includes(by.id))) {
        return `"${by.id}" cannot approve a request of its own delegation chain`;
    }
    if (request.forbidSelfApproval) {
        // Only when the request says who asked: with no `userId` there is nobody to compare with.
        const asker = principal.userId;
        if ((asker !== undefined && by.id === asker) || (by.kind === 'human' && principal.chain.includes(by.id))) {
            return `"${by.id}" asked for this action and cannot approve it: someone else has to`;
        }
    }
    if (by.kind === 'agent' && !(await canAgentAct(by))) {
        return `agent "${by.id}" cannot approve an action it is not allowed to perform itself`;
    }
    return undefined;
}

/** What `checkApproval` needs besides the answer and the request. */
export interface ApprovalCheckDeps {
    /** Can this agent approver do the action itself? (SPEC-0014 §6.2 rule 3.) */
    canAgentAct: (approver: ApproverRef) => Promise<boolean>;
    /** Who the approvers are and what roles they hold. Without it, an `ask` that names roles cannot be approved. */
    approverDirectory?: ApproverDirectory;
    /** Four eyes: the person the agent acts for (`principal.userId`) does not approve it either. */
    forbidSelfApproval?: boolean;
    /**
     * With four eyes on, refuse an approval of a request that does not say who asked (`principal.userId`): nobody can be told apart from the requester,
     * and "on, but it does nothing" is a silent failure. The engine does not ask for it because it already requires `identity.userId` by default (SPEC-0044)
     * and, when that is switched off for tests, keeps its documented behaviour (the rule does nothing). A flow, a handler and a tool server do ask for it.
     */
    requireRequester?: boolean;
}

/**
 * THE check of an approval, for every way an approval is given: the engine (in process or a stored one), a flow, the handler a supervisor decides
 * through, and the direct tool server. It is the rules of SPEC-0014 §6.2 (kind accepted, nobody approves their own request, an agent only what it could
 * do) plus four eyes (SPEC-0041 F2) plus the roles the `ask` asked for, checked against the directory (SPEC-0041). `problem` is the reason it is
 * not valid; when it is, `authority` says what was recognized of the approver, for the audit. Having ONE function is the point: a path that checked
 * less than the others is a way around them, and three copies had drifted.
 */
export async function checkApproval(
    outcome: ApprovalOutcome,
    request: { principal: Principal; accepts?: ApproverKind[]; approverRoles?: string[] },
    deps: ApprovalCheckDeps,
): Promise<{ problem: string } | { authority?: ApproverAuthority }> {
    // Four eyes needs to know who asked. With no `userId` there is nobody to compare the approver with, and "on, but it does nothing" is the silent
    // failure this function exists to end: it is refused, and the reason says how to fix it.
    if (deps.forbidSelfApproval && deps.requireRequester && request.principal.userId === undefined) {
        return { problem: 'four eyes (forbidSelfApproval) is on and the request does not say who asked for it (principal.userId): nobody can be told apart from the requester' };
    }
    const problem = await approvalProblem(outcome, { ...request, ...(deps.forbidSelfApproval ? { forbidSelfApproval: true } : {}) }, deps.canAgentAct);
    if (problem) return { problem };
    return approverAuthority(outcome.by, request, deps.approverDirectory);
}

/** What a person is shown of the arguments: long enough for a real call, and it says so when it cuts (a cut hides what follows). */
export const APPROVAL_PREVIEW_CHARS = 4000;
export function previewArgs(json: string, max: number = APPROVAL_PREVIEW_CHARS): { text: string; truncated: boolean } {
    if (json.length <= max) return { text: json, truncated: false };
    return { text: `${json.slice(0, max)} ... [${json.length - max} more characters NOT shown]`, truncated: true };
}

/** The legacy callback (`onToolApproval`) seen as an `Approver`; see {@link approverFromCallback}. */
export interface CallbackApprover extends Approver {
    /** Stop asking for the rest of the session (what 'approve_all' does). Destructive calls still ask. */
    disable(): void;
    enable(): void;
}

/**
 * Adapts `onToolApproval(toolName, agentId, argsPreview)` to the `Approver` contract. Its answers count as a
 * person's (`kind: 'human'`). 'approve_all' stops asking for the rest of the session, except for destructive
 * tools: an irreversible action is never approved in bulk (SPEC-0014 §4).
 *
 * @deprecated Pass an `Approver` instead. Kept so that existing `onToolApproval` callers work in the new path.
 */
export function approverFromCallback(
    onToolApproval: (toolName: string, agentId: string, argsPreview: string) => Promise<ToolApprovalDecision>,
    opts: { id?: string; onAsk?: (req: ApprovalRequest, preview: string) => void } = {},
): CallbackApprover {
    const ref: ApproverRef = { kind: 'human', id: opts.id ?? 'operator' };
    let approveAll = false;
    return {
        ref,
        disable: () => { approveAll = true; },
        enable: () => { approveAll = false; },
        async request(req: ApprovalRequest): Promise<ApprovalOutcome> {
            const at = () => new Date().toISOString();
            const subject = req.subject;
            const call = subject.kind === 'tool_call' && 'call' in subject ? subject.call : undefined;
            // "Approve all" never covers what only a person may approve (destructive tools, package installs...).
            const humanOnly = !!call?.tool.destructive || (req.accepts?.length === 1 && req.accepts[0] === 'human');
            if (approveAll && !humanOnly) return { decision: 'approve', by: ref, reason: 'approve all (session)', at: at() };
            const name = call ? call.tool.name : subject.kind;
            const preview = previewArgs(call ? JSON.stringify(call.args) : JSON.stringify(subject)).text;
            opts.onAsk?.(req, preview);
            const decision: unknown = await onToolApproval(name, req.principal.agentId, preview);
            // Only an explicit approval approves (ADR-0010): `undefined`, an unknown value or a typo is a rejection.
            if (decision === 'approve_all') approveAll = true;
            const approved = decision === 'approve' || decision === 'approve_all';
            return { decision: approved ? 'approve' : 'reject', by: ref, at: at(), ...(approved || decision === 'reject' ? {} : { reason: `the approver gave no decision (${JSON.stringify(decision) ?? 'undefined'})` }) };
        },
    };
}
