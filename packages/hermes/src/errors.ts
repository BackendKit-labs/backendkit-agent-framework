/** Who is asking. It comes from the transport (a JWT, an MCP token, the host's login); Hermes only reads it. */
export interface Principal {
    id: string;
    roles: string[];
}

export type HermesErrorCode =
    | 'FORBIDDEN' | 'APPROVAL_REQUIRED' | 'AGENT_NOT_FOUND' | 'AGENT_UNAVAILABLE' | 'CAPABILITY_NOT_FOUND' | 'RUN_NOT_FOUND' | 'RUN_FAILED'
    | 'POLICY_WIDER_THAN_PARENT' | 'CONTROL_UNSUPPORTED' | 'INVALID_INPUT'
    | 'BLUEPRINT_NOT_FOUND' | 'LIMIT_REACHED' | 'PROVISION_FAILED'
    /** The agent is at its `limits.maxConcurrent`: try again when one of its runs ends. */
    | 'AGENT_BUSY';

export class HermesError extends Error {
    constructor(readonly code: HermesErrorCode, message: string, readonly details?: unknown) {
        super(message);
        this.name = 'HermesError';
    }
}

export interface ApprovalRequest {
    action: 'run' | 'cancel' | 'policy_set' | 'job_cancel' | 'agent_create';
    principal: Principal;
    agentId: string;
    capability: string;
    /** The input, masked and cut: what a human needs to decide. */
    inputPreview?: string;
    runId?: string;
}

/** Decides whether an action that asks for approval may go on. Without one, those actions are refused. */
export type Approver = (request: ApprovalRequest) => boolean | Promise<boolean>;

/** What Hermes tells the host about, for alerts and for triggering flows. */
export type HermesEvent =
    | { type: 'fleet.gap'; gapId: string; need: string; mode: 'notify' | 'create' | 'propose'; principalId: string }
    | { type: 'fleet.agent.created'; instanceId: string; blueprintId: string; createdBy: string; gapId?: string }
    | { type: 'fleet.agent.retired'; instanceId: string; blueprintId: string; reason: string }
    | { type: 'fleet.blueprint.proposed'; draftId: string; proposedBy: string; gapId?: string }
    | { type: 'fleet.blueprint.decided'; draftId: string; decision: 'approved' | 'rejected'; decidedBy: string }
    | { type: 'fleet.agent.state'; agentId: string; from: string; to: string }
    | { type: 'run.done'; runId: string; agentId: string; capability: string; status: string };
