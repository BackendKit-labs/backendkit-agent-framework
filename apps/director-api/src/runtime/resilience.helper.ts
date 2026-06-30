import { Logger } from '@nestjs/common';
import { CircuitBreaker, CircuitBreakerOpenError, DEFAULT_CIRCUIT_BREAKER_CONFIG } from '@backendkit-labs/circuit-breaker';

const logger = new Logger('RuntimeResilience');

// One circuit breaker per runtime kind, shared across adapter instances
const breakers = new Map<string, CircuitBreaker>();

function getBreaker(kind: string): CircuitBreaker {
  if (!breakers.has(kind)) {
    breakers.set(kind, new CircuitBreaker({
      ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
      name: `runtime-${kind}`,
      failureThreshold: 50,       // open when 50% of last 10 calls fail
      openTimeoutMs: 30_000,      // try half-open after 30s
      halfOpenMaxCalls: 2,
    }));
  }
  return breakers.get(kind)!;
}

async function retryN<T>(fn: () => Promise<T>, maxAttempts: number, baseDelayMs: number): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, baseDelayMs * attempt));
      }
    }
  }
  throw lastErr;
}

/**
 * Wraps a runtime operation with retry + circuit breaker.
 *
 * - Retries transient errors up to `maxAttempts` times with linear backoff.
 * - Routes calls through the per-kind circuit breaker; open circuit → fast fail.
 */
export async function withResilience<T>(
  kind: string,
  operation: string,
  fn: () => Promise<T>,
  options: { maxAttempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const cb   = getBreaker(kind);
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;

  try {
    return await cb.execute(() => retryN(fn, maxAttempts, baseDelayMs));
  } catch (err) {
    if (err instanceof CircuitBreakerOpenError) {
      logger.warn(`[${kind}] circuit open — ${operation} fast-failed`);
    } else {
      logger.warn(`[${kind}] ${operation} failed after ${maxAttempts} attempts: ${(err as Error).message}`);
    }
    throw err;
  }
}

/** Expose circuit state for health checks */
export function getRuntimeCircuitState(kind: string): { state: string; metrics: unknown } {
  const cb = breakers.get(kind);
  if (!cb) return { state: 'closed', metrics: null };
  return { state: cb.getState(), metrics: cb.getMetrics() };
}
