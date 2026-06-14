export const PROTOCOL_VERSION = '1' as const;

// ── Context ───────────────────────────────────────────────────────────────────

export interface AgentContext {
    tenantId?:  string;
    traceId?:   string;
    requestId?: string;
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
}

// ── Task ──────────────────────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface TaskRecord {
    taskId:      string;
    status:      TaskStatus;
    output?:     unknown;
    error?:      string;
    startedAt:   string;
    finishedAt?: string;
    durationMs?: number;
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
    | 'TIMEOUT';

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
