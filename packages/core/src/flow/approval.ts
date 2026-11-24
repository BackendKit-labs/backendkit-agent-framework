import type {
    ApprovalOutcome, ApprovalRequest, ApprovalStore, Approver, ApproverDirectory, ApproverRef, Identity, Principal, ToolPolicy,
} from '../governance/types';
import { checkApproval } from '../governance/approval';
import type { FlowStep } from './types';

/**
 * Approval of a flow step through the `ApprovalStore` of SPEC-0014 (SPEC-0023 F5). A step needs approval when its gate says
 * `approval: human`, or when the `policy` decides `ask` for the pseudo tool `flow.step:<stepId>` (which is how a learned rule
 * can put a step behind a person). The request is stored with a deterministic id, so resuming the run finds the answer.
 */
export interface FlowApprovals {
    store: ApprovalStore;
    /** Who the flow acts for. The agent is the step's agent and the session is the run. */
    identity?: Identity;
    chain?: string[];
    /** Decides per step; `ask` stops it for approval, `deny` fails it. No policy: only `gate.approval: human` asks. */
    policy?: ToolPolicy;
    /** Answers in process (a CLI, a connected UI). Without one the run stops with `awaiting_approval` until someone resolves the store. */
    approver?: Approver;
    /**
     * `before` (default): the person approves the ACTION and the step runs after. `after`: the step runs, its output is shown to
     * the approver (it is in the request) and the steps that follow wait for the decision; a rejection fails the step.
     */
    when?: 'before' | 'after';
    /** Can this agent approver do the step itself? Default: no (SPEC-0014 §6.2 rule 3). */
    canAgentAct?: (by: ApproverRef, step: FlowStep) => Promise<boolean>;
    /**
     * Who the approvers are and what roles they hold. A policy that asks for the step with `approverRoles` is decided only by someone who holds one,
     * and with no directory it cannot be decided at all (SPEC-0041). It is checked when the decision is made here AND when a decision made elsewhere
     * (a supervisor, the handler of another process) is used to go on.
     */
    approverDirectory?: ApproverDirectory;
    /** Four eyes: whoever the flow acts for (`identity.userId`) does not approve a step either. Without `identity.userId` the step is denied: nobody can be told apart. */
    forbidSelfApproval?: boolean;
}

export type StepApproval =
    | { kind: 'proceed' }
    | { kind: 'rejected'; reason: string }
    | { kind: 'denied'; reason: string }
    | { kind: 'pending'; approvalId: string };

export function stepApprovalId(runId: string, stepId: string): string {
    return `${runId}-${stepId}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128);
}

export async function decideStepApproval(
    a: FlowApprovals, flow: string, runId: string, step: FlowStep, previous: Record<string, string>, output?: string,
): Promise<StepApproval> {
    const principal: Principal = { agentId: step.agent, sessionId: runId, chain: a.chain ?? [], ...(a.identity ?? {}) };
    const human = step.gate?.approval === 'human';

    let reason = human ? `step "${step.id}" of flow "${flow}" requires human approval` : '';
    let approver: string | undefined;
    let approverRoles: string[] | undefined;
    let accepts: ApprovalRequest['accepts'] = human ? ['human'] : undefined;
    if (a.policy) {
        const d = await a.policy.decide(principal, {
            tool: { name: `flow.step:${step.id}`, description: `step "${step.id}" of flow "${flow}"`, parameters: { type: 'object', properties: {} }, execute: async () => '' },
            args: { input: previous, ...(output !== undefined ? { output } : {}) },
        });
        if (d.effect === 'deny') return { kind: 'denied', reason: d.reason };
        if (d.effect === 'ask') {
            reason = d.reason;
            approver = d.approver;
            approverRoles = d.approverRoles;
            if (d.accepts) accepts = human && !d.accepts.includes('human') ? ['human'] : d.accepts;
        } else if (!human) {
            return { kind: 'proceed' };
        }
    } else if (!human) {
        return { kind: 'proceed' };
    }

    const deps = {
        canAgentAct: async (by: ApproverRef) => a.canAgentAct?.(by, step) ?? false,
        ...(a.approverDirectory ? { approverDirectory: a.approverDirectory } : {}),
        ...(a.forbidSelfApproval ? { forbidSelfApproval: true, requireRequester: true } : {}),
    };
    const id = stepApprovalId(runId, step.id);
    let stored = await a.store.get(id);
    if (!stored) {
        const req: ApprovalRequest = {
            id, principal, subject: { kind: 'workflow_step', workflow: flow, step: step.id, input: output !== undefined ? { previous, output } : previous },
            reason, ...(approver ? { approver } : {}), ...(accepts ? { accepts } : {}), ...(approverRoles ? { approverRoles } : {}), createdAt: new Date().toISOString(),
        };
        await a.store.put(req);
        stored = await a.store.get(id);
    }
    if (stored && stored.status === 'pending' && a.approver) {
        const outcome: ApprovalOutcome = await a.approver.request(stored);
        const checked = await checkApproval(outcome, { ...stored, ...(approverRoles ? { approverRoles } : {}) }, deps);
        stored = await a.store.resolve(id, 'problem' in checked
            ? { decision: 'reject', by: outcome.by ?? { kind: 'service', id: 'engine' }, reason: checked.problem, at: new Date().toISOString() }
            : outcome);
    }
    if (!stored || stored.status === 'pending') return { kind: 'pending', approvalId: id };
    if (stored.status === 'rejected') return { kind: 'rejected', reason: stored.outcome?.reason ?? 'rejected' };
    // Approved, or executed on a previous attempt. A decision made elsewhere (a supervisor, another process) is checked again here, against the
    // roles of the policy of now and the directory of now: the step does not go on because someone said yes, but because that someone could.
    if (stored.outcome) {
        const checked = await checkApproval(stored.outcome, { ...stored, ...(approverRoles ? { approverRoles } : {}) }, deps);
        if ('problem' in checked) return { kind: 'denied', reason: `invalid approval: ${checked.problem}` };
    }
    return { kind: 'proceed' };
}
