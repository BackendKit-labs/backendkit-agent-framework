import { CircuitBreaker, CircuitBreakerOpenError, CircuitBreakerState } from '@backendkit-labs/circuit-breaker';
import type { LLMChatClient } from './chat-client';

export interface ResilientLLMClientOptions {
    client: LLMChatClient;
    /** Circuit breaker name, e.g. 'openai', 'deepseek'. Default: 'llm-provider' */
    name?: string;
    /** % of failures in the sliding window to open the circuit. Default: 50 */
    failureThreshold?: number;
    /** Minimum calls before thresholds are evaluated. Default: 5 */
    minimumCalls?: number;
    /** ms to wait in OPEN before transitioning to HALF_OPEN. Default: 30_000 */
    openTimeoutMs?: number;
    /** Called on every state transition — use for logging or alerting */
    onStateChange?: (from: CircuitBreakerState, to: CircuitBreakerState) => void;
}

/**
 * Wraps any LLMChatClient with a CircuitBreaker.
 *
 * When the provider fails repeatedly the circuit opens and subsequent calls
 * return { content: null } immediately instead of waiting for timeouts.
 * After openTimeoutMs the circuit transitions to HALF_OPEN and lets a probe
 * call through to test recovery.
 *
 * Pair with ResilientLLMClient + retry for full resilience:
 *   retry handles transient blips; circuit breaker handles sustained outages.
 */
export class ResilientLLMClient implements LLMChatClient {
    private readonly breaker: CircuitBreaker;
    private readonly inner: LLMChatClient;

    constructor(opts: ResilientLLMClientOptions) {
        this.inner = opts.client;
        this.breaker = new CircuitBreaker({
            name: opts.name ?? 'llm-provider',
            failureThreshold: opts.failureThreshold ?? 50,
            slowCallThreshold: 100,      // disabled — LLM calls are slow by nature
            slowCallDurationMs: 120_000, // 2 min threshold for "slow"
            minimumCalls: opts.minimumCalls ?? 5,
            slidingWindowSize: 10,
            halfOpenMaxCalls: 2,
            openTimeoutMs: opts.openTimeoutMs ?? 30_000,
            isFailure: (err) => {
                // HTTP 4xx (auth, quota) → handled by retry, not a circuit failure
                if (err && typeof err === 'object' && 'status' in err) {
                    const status = (err as { status: number }).status;
                    return status >= 500;
                }
                // Network errors and 5xx open the circuit
                return true;
            },
            onStateChange: opts.onStateChange,
        });
    }

    async chat(
        messages: Array<{ role: string; content: string }>,
        tools?: unknown,
        temperature?: number,
    ): Promise<{ content: string | null }> {
        return this.breaker.execute(
            () => this.inner.chat(messages, tools, temperature),
            (err) => {
                if (err instanceof CircuitBreakerOpenError) {
                    // Circuit is open — fail fast with null, caller decides fallback
                    return { content: null };
                }
                // Infrastructure error that opened the circuit — let retry handle it
                throw err;
            },
        );
    }

    getMetrics() {
        return this.breaker.getMetrics();
    }

    getState(): CircuitBreakerState {
        return this.breaker.getState();
    }
}
