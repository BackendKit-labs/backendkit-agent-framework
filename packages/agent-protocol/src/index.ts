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
