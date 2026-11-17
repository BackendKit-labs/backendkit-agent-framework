import type { AgentContext, ApprovalDecision, ApprovalStatus, ApprovalSummary } from '../types';

/**
 * What a service plugs into `AgentServer` so a supervisor (Hermes, a console, an MCP client) can see what is waiting for a
 * person and answer it (protocol 1.2). The protocol only defines the surface; the host owns the store of approvals and the
 * rules about who may approve what: `decide` must check the approver (`decision.by`) before accepting its answer, because the
 * server only knows the caller holds the control key, not who is behind it.
 *
 * All of it needs the `controlApiKey`: an approval carries the input and output of a step, as sensitive as the conversation.
 * Throw a `ControlError`: `TASK_NOT_FOUND` for an unknown id, `CONFLICT` if it was already decided, `FORBIDDEN` if the approver
 * is not allowed to decide it.
 */
export interface ApprovalHandler {
    list(filter: { status?: ApprovalStatus }): Promise<ApprovalSummary[]>;
    get(id: string): Promise<ApprovalSummary>;
    decide(id: string, decision: ApprovalDecision, context: AgentContext): Promise<ApprovalSummary>;
}
