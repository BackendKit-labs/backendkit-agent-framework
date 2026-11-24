import type { ApprovalOutcome, ApprovalStatus, ApprovalStore, ApproverDirectory, ApproverKind, ApproverRef, StoredApproval } from '../governance/types';
import { checkApproval } from '../governance/approval';

/**
 * The approvals of an agent as the `approvalHandler` an `AgentServer` takes (`ApprovalHandler` of `@backendkit-labs/agent-protocol`,
 * protocol 1.2), declared here with the same shape so that core depends on no transport (SPEC-0023 F6c). A supervisor, a console or an
 * MCP client then sees what waits for a person and decides it.
 */

export interface ApprovalSummaryView {
    id: string;
    status: ApprovalStatus;
    subject: { kind: string; [key: string]: unknown };
    reason: string;
    approver?: string;
    accepts?: ApproverKind[];
    requestedBy: { agentId: string; sessionId?: string; tenantId?: string };
    createdAt: string;
    outcome?: { decision: 'approve' | 'reject'; by: ApproverRef; reason?: string; at: string };
}

export interface ApprovalDecisionInput {
    decision: 'approve' | 'reject';
    reason?: string;
    by: ApproverRef;
}

export interface ApprovalHandlerPort {
    list(filter: { status?: ApprovalStatus }): Promise<ApprovalSummaryView[]>;
    get(id: string): Promise<ApprovalSummaryView>;
    decide(id: string, decision: ApprovalDecisionInput, context?: unknown): Promise<ApprovalSummaryView>;
}

/** A refusal with a protocol code. `AgentServer` recognises it by `name` and `code`. */
export class ApprovalControlError extends Error {
    constructor(readonly code: 'TASK_NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN', message: string) {
        super(message);
        this.name = 'ControlError';
    }
}

export interface ApprovalHandlerOptions {
    /** Can this agent approver do the action itself? Default: no (SPEC-0014 §6.2 rule 3), so only humans and services decide. */
    canAgentAct?: (by: ApproverRef, request: StoredApproval) => Promise<boolean>;
    /**
     * Called after a decision is recorded, for the host to continue what waited for it: for a flow step, run the flow again with the
     * same `runId`. A throw here does not undo the decision.
     */
    onDecided?: (approval: StoredApproval) => void | Promise<void>;
    /**
     * Who the approvers are and what roles they hold. A request that asks for roles (`approverRoles`) is decided only by someone who holds one, and
     * with no directory it cannot be decided at all: an approval that cannot be checked is not accepted (SPEC-0041).
     */
    approverDirectory?: ApproverDirectory;
    /** Four eyes: the person the request was made for (`principal.userId`) cannot decide it. A request that does not say who asked is refused. */
    forbidSelfApproval?: boolean;
}

/** What a reviewer sees. A tool call shows the tool and its arguments, not the whole definition. */
export function summarizeApproval(a: StoredApproval): ApprovalSummaryView {
    const s = a.subject;
    const subject: ApprovalSummaryView['subject'] = s.kind === 'tool_call' && 'call' in s
        ? { kind: 'tool_call', tool: s.call.tool.name, args: s.call.args }
        : { ...(s as { kind: string }) };
    return {
        id: a.id,
        status: a.status,
        subject,
        reason: a.reason,
        ...(a.approver ? { approver: a.approver } : {}),
        ...(a.accepts ? { accepts: a.accepts } : {}),
        requestedBy: {
            agentId: a.principal.agentId, sessionId: a.principal.sessionId, ...(a.principal.tenantId ? { tenantId: a.principal.tenantId } : {}),
        },
        createdAt: a.createdAt,
        ...(a.outcome ? { outcome: { decision: a.outcome.decision, by: a.outcome.by, ...(a.outcome.reason ? { reason: a.outcome.reason } : {}), at: a.outcome.at } } : {}),
    };
}

export function createApprovalHandler(store: ApprovalStore, options: ApprovalHandlerOptions = {}): ApprovalHandlerPort {
    const find = async (id: string): Promise<StoredApproval> => {
        let found: StoredApproval | undefined;
        try { found = await store.get(id); } catch { /* an id the store refuses is an id it does not have */ }
        if (!found) throw new ApprovalControlError('TASK_NOT_FOUND', `approval ${id} not found`);
        return found;
    };
    return {
        list: async filter => (await store.list(filter.status ? { status: filter.status } : {})).map(summarizeApproval),
        get: async id => summarizeApproval(await find(id)),
        decide: async (id, d) => {
            const request = await find(id);
            if (request.status !== 'pending') throw new ApprovalControlError('CONFLICT', `approval ${id} was already decided (${request.status})`);
            const outcome: ApprovalOutcome = {
                decision: d.decision, by: d.by, ...(d.reason ? { reason: d.reason } : {}), at: new Date().toISOString(),
            };
            // An answer that breaks the rules (wrong kind of approver, one's own request) is refused, not recorded as a rejection:
            // the approver is told, and the request stays open for someone who may decide it.
            const checked = await checkApproval(outcome, request, {
                canAgentAct: async by => options.canAgentAct?.(by, request) ?? false,
                ...(options.approverDirectory ? { approverDirectory: options.approverDirectory } : {}),
                ...(options.forbidSelfApproval ? { forbidSelfApproval: true, requireRequester: true } : {}),
            });
            if ('problem' in checked) throw new ApprovalControlError('FORBIDDEN', checked.problem);
            let stored: StoredApproval;
            try {
                stored = await store.resolve(id, outcome);
            } catch (err) {
                // Another decision won the race: the store accepts one per id.
                throw new ApprovalControlError('CONFLICT', (err as Error).message);
            }
            try { await options.onDecided?.(stored); } catch { /* the decision stands */ }
            return summarizeApproval(stored);
        },
    };
}
