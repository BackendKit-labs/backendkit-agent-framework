import type { ToolApprovalDecision } from '../types';
import type {
    ApprovalOutcome, ApprovalRequest, Approver, ApproverKind, ApproverRef, Principal,
} from './types';

/**
 * Checks an approver's answer against the rules of SPEC-0014 §6.2 before the engine accepts it. Returns the reason
 * it is not valid, or undefined when it is. An invalid approval is treated as a rejection.
 *
 * 1. The approver's kind is one the decision accepts.
 * 2. Nobody approves their own request: not the agent that asked, nor any agent in its delegation chain.
 * 3. An agent approves only what it could do itself (`canAgentAct`, evaluated by the engine with that agent as
 *    principal over the same call).
 *
 * Rule 4 (every approval audited with its approver in full) is the engine's job when it writes the event.
 */
export async function approvalProblem(
    outcome: ApprovalOutcome,
    request: { principal: Principal; accepts?: ApproverKind[] },
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
    if (by.kind === 'agent' && !(await canAgentAct(by))) {
        return `agent "${by.id}" cannot approve an action it is not allowed to perform itself`;
    }
    return undefined;
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
            const preview = (call ? JSON.stringify(call.args) : JSON.stringify(subject)).slice(0, 200);
            opts.onAsk?.(req, preview);
            const decision = await onToolApproval(name, req.principal.agentId, preview);
            if (decision === 'approve_all') approveAll = true;
            return { decision: decision === 'reject' ? 'reject' : 'approve', by: ref, at: at() };
        },
    };
}
