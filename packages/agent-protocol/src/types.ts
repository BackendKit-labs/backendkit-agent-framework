export const PROTOCOL_VERSION = '1' as const;

// ── Context ───────────────────────────────────────────────────────────────────

export interface AgentContext {
    tenantId?:  string;
    traceId?:   string;
    requestId?: string;
    /** Adds the USD this run spent. Set by `AgentServer` on capability runs; the total travels in the answer as `costUsd`. */
    reportCost?: (usd: number) => void;
}

// ── Capability schema ─────────────────────────────────────────────────────────

export interface CapabilityField {
    type:        'string' | 'number' | 'boolean' | 'array' | 'object';
    required?:   boolean;
    default?:    unknown;
    description?: string;
}

export type CapabilitySchema = Record<string, CapabilityField>;

export interface CapabilityDefinition {
    name:        string;
    description: string;
    async:       boolean;
    input:       CapabilitySchema;
    output:      CapabilitySchema;
}

// ── Agent info ────────────────────────────────────────────────────────────────

export interface AgentInfo {
    name:         string;
    version:      string;
    description:  string;
    capabilities: CapabilityDefinition[];
    /** Minor revision of protocol v1 the server speaks. Absent on servers older than 1.1. */
    protocolMinor?: number;
    /** Declared limits (e.g. `maxConcurrent`, `budgetUsdPerDay`) so a supervisor can plan around them. */
    limits?:      Record<string, number>;
    /** Flows this agent hosts and can be asked to run, by name. */
    flows?:       FlowDescriptor[];
    /** Control actions this server accepts (only when control is enabled). */
    control?:     ControlAction[];
    /** The server can start, watch and steer the flows it hosts (see `FlowHandler`). */
    flowControl?: boolean;
}

export interface FlowDescriptor {
    name:         string;
    description?: string;
    steps?:       string[];
}

// ── Flows (protocol 1.1) ──────────────────────────────────────────────────────

export type FlowStatus = 'running' | 'paused' | 'done' | 'failed' | 'cancelled';

export interface FlowStepState {
    name:    string;
    status:  'pending' | 'running' | 'done' | 'failed' | 'skipped';
    detail?: string;
}

/** A flow run seen from outside: where it is, step by step. */
export interface FlowRunState {
    flowRunId:    string;
    flow:         string;
    status:       FlowStatus;
    currentStep?: string;
    steps:        FlowStepState[];
    startedAt:    string;
    finishedAt?:  string;
    output?:      string;
    error?:       string;
}

export type FlowSteerAction = 'pause' | 'resume' | 'cancel';
export const FLOW_STEER_ACTIONS: readonly FlowSteerAction[] = ['pause', 'resume', 'cancel'];

// ── Control (protocol 1.1) ────────────────────────────────────────────────────

/** Minor revision of protocol v1 implemented here. 1.1 adds the control surface; everything in 1.0 is unchanged. */
export const PROTOCOL_MINOR = 1 as const;

export const CONTROL_ACTIONS = [
    'pause', 'resume', 'drain', 'set_budget',
    'get_sandbox_policy', 'set_sandbox_policy',
    'list_jobs', 'cancel_job',
] as const;
export type ControlAction = typeof CONTROL_ACTIONS[number];

export interface ControlRequest {
    action:  ControlAction;
    params?: Record<string, unknown>;
}

/** One run, active or recent. */
export interface RunSummary {
    runId:       string;
    capability?: string;
    status:      TaskStatus;
    startedAt:   string;
    finishedAt?: string;
}

/** One line of an agent's audit trail (sandbox and engine decisions). Extra fields are allowed. */
export interface AuditEntry {
    ts:        string;
    agentId?:  string;
    tool?:     string;
    outcome?:  string;
    detail?:   string;
    [key: string]: unknown;
}

export interface AuditQuery {
    /** ISO timestamp: only entries at or after it. */
    since?: string;
    limit?: number;
}

// ── Task ──────────────────────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface TaskRecord {
    taskId:      string;
    capability?: string;
    status:      TaskStatus;
    output?:     unknown;
    error?:      string;
    startedAt:   string;
    finishedAt?: string;
    durationMs?: number;
    /** USD the run spent, when the handler reported it (`context.reportCost`). */
    costUsd?:    number;
}

// ── Run ───────────────────────────────────────────────────────────────────────

export interface RunRequest {
    capability: string;
    input:      Record<string, unknown>;
    async?:     boolean;
}

export interface RunResponse {
    status:   'done' | 'running';
    output?:  unknown;
    taskId?:  string;
    /** USD the run spent, when the handler reported it. Absent = not measured, not zero. */
    costUsd?: number;
}

// ── Protocol envelope ─────────────────────────────────────────────────────────

export type ErrorCode =
    | 'UNAUTHORIZED'
    | 'FORBIDDEN'
    | 'CAPABILITY_NOT_FOUND'
    | 'INVALID_INPUT'
    | 'TASK_NOT_FOUND'
    | 'EXECUTION_FAILED'
    | 'AGENT_UNAVAILABLE'
    | 'TIMEOUT'
    // protocol 1.1 (control)
    /** The server has no control handler, or the handler does not support this action. */
    | 'CONTROL_UNSUPPORTED'
    /** A requested execution policy is wider than the one in force; widening needs approval. */
    | 'POLICY_WIDER_THAN_PARENT'
    | 'APPROVAL_REQUIRED';

export interface ProtocolError {
    code:     ErrorCode;
    message:  string;
    details?: unknown;
}

export interface ResponseMeta {
    traceId?:      string;
    agentVersion?: string;
    durationMs?:   number;
}

export interface ProtocolResponse<T = unknown> {
    ok:    boolean;
    data:  T | null;
    error: ProtocolError | null;
    meta:  ResponseMeta;
}
