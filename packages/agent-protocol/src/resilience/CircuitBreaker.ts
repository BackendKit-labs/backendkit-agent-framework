// Re-export @backendkit-labs/circuit-breaker as the canonical implementation.
// Replaces the hand-rolled version — the BK lib adds sliding-window thresholds,
// business vs infrastructure error classification, metrics, and onStateChange hooks.
export {
    CircuitBreaker,
    CircuitBreakerState,
    CircuitBreakerRegistry,
    CircuitBreakerOpenError,
    isHttpServerError,
} from '@backendkit-labs/circuit-breaker';
export type {
    CircuitBreakerConfig,
    CircuitBreakerOptions,
    CircuitBreakerMetrics,
} from '@backendkit-labs/circuit-breaker';

// Backward-compat alias (v0.1.0 exported CircuitState with uppercase values).
// Prefer CircuitBreakerState going forward.
export type CircuitState = import('@backendkit-labs/circuit-breaker').CircuitBreakerState;
