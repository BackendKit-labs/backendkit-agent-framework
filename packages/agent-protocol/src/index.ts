// ── Protocol version ──────────────────────────────────────────────────────────
export { PROTOCOL_VERSION, PROTOCOL_MINOR, CONTROL_ACTIONS, FLOW_STEER_ACTIONS } from './types';

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
    ControlAction,
    ControlRequest,
    RunSummary,
    AuditEntry,
    AuditQuery,
    FlowDescriptor,
    FlowRunState,
    FlowStepState,
    FlowStatus,
    FlowSteerAction,
} from './types';

// ── Server ────────────────────────────────────────────────────────────────────
export { AgentServer }         from './server/AgentServer';
export type { AgentServerOptions, CapabilityHandler } from './server/AgentServer';
export { TaskStore }           from './server/TaskStore';
export { ControlError, statusForCode } from './server/ControlHandler';
export type { FlowHandler } from './server/FlowHandler';
export type { ControlHandler } from './server/ControlHandler';

// ── Client ────────────────────────────────────────────────────────────────────
export { AgentClient }         from './client/AgentClient';
export type { AgentClientOptions, RunOptions } from './client/AgentClient';

// ── Resilience — circuit breaker (@backendkit-labs/circuit-breaker) ───────────
export {
    CircuitBreaker,
    CircuitBreakerState,
    CircuitBreakerRegistry,
    CircuitBreakerOpenError,
    isHttpServerError,
} from './resilience/CircuitBreaker';
export type {
    CircuitBreakerConfig,
    CircuitBreakerOptions,
    CircuitBreakerMetrics,
    CircuitState,           // backward-compat alias for CircuitBreakerState
} from './resilience/CircuitBreaker';

// ── Resilience — retry (@backendkit-labs/retry) ───────────────────────────────
export { withRetry }           from './resilience/retry';
export type { RetryOptions }   from './resilience/retry';
