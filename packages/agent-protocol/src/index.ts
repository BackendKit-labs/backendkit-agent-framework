// ── Protocol version ──────────────────────────────────────────────────────────
export { PROTOCOL_VERSION } from './types';

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
    AgentContext,
    AgentInfo,
    CapabilityDefinition,
    CapabilityField,
    CapabilitySchema,
    TaskStatus,
    TaskRecord,
    RunRequest,
    RunResponse,
    ErrorCode,
    ProtocolError,
    ProtocolResponse,
    ResponseMeta,
} from './types';

// ── Server ────────────────────────────────────────────────────────────────────
export { AgentServer }         from './server/AgentServer';
export type { AgentServerOptions, CapabilityHandler } from './server/AgentServer';
export { TaskStore }           from './server/TaskStore';

// ── Client ────────────────────────────────────────────────────────────────────
export { AgentClient }         from './client/AgentClient';
export type { AgentClientOptions, RunOptions } from './client/AgentClient';

// ── Resilience ────────────────────────────────────────────────────────────────
export { withRetry }           from './resilience/retry';
export type { RetryOptions }   from './resilience/retry';
export { CircuitBreaker }      from './resilience/CircuitBreaker';
export type { CircuitBreakerOptions, CircuitState } from './resilience/CircuitBreaker';
