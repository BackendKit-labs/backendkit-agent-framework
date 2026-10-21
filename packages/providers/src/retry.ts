import { retry } from '@backendkit-labs/retry';

export interface RetryOptions {
    /** Total attempts, first try included. */
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    /** Receives the error thrown by the task (the original object, not a wrapper). */
    shouldRetry(err: unknown): boolean;
    /** Once aborted the task is never retried. */
    signal?: AbortSignal;
}

/**
 * Runs `task` with exponential backoff via @backendkit-labs/retry and rethrows the *original*
 * error when the attempts are exhausted or the error is not retryable.
 */
export async function withRetry<T>(task: () => Promise<T>, o: RetryOptions): Promise<T> {
    const result = await retry(task, {
        maxAttempts: Math.max(1, o.maxAttempts),
        backoff: { type: 'exponential', baseDelay: o.baseDelayMs, maxDelay: o.maxDelayMs, jitter: 'equal' },
        retryIf: (e) => !o.signal?.aborted && o.shouldRetry(e.cause),
    });
    if (result.ok) return result.value;
    throw result.error.cause ?? new Error(result.error.message);
}

// ── Error classification ──────────────────────────────────────────────────────

const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE']);

export function httpStatus(err: unknown): number | undefined {
    if (err && typeof err === 'object' && 'status' in err) {
        const s = (err as { status: unknown }).status;
        return typeof s === 'number' ? s : undefined;
    }
    return undefined;
}

/** Connection-level failure (no HTTP response). Aborts are not network errors. */
export function isNetworkError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as { name?: string; code?: string; message?: string; cause?: unknown };
    if (e.name === 'APIUserAbortError' || e.name === 'AbortError') return false;
    if (e.name === 'APIConnectionError' || e.name === 'APIConnectionTimeoutError') return true;
    if (e.code && NETWORK_CODES.has(e.code)) return true;
    if (/fetch failed|socket hang up|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT/i.test(e.message ?? '')) return true;
    return e.cause !== undefined && e.cause !== err && isNetworkError(e.cause);
}

/** 429, 5xx and network errors. */
export function isTransient(err: unknown): boolean {
    const status = httpStatus(err);
    if (status !== undefined) return status === 429 || status >= 500;
    return isNetworkError(err);
}
