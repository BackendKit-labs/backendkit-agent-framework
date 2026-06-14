// Thin wrapper around @backendkit-labs/retry that preserves the original
// withRetry() signature (throws on failure) while using RetryEngine under the hood.
// The BK engine adds: sliding-window budget, per-attempt timeout, Retry-After
// support, and correct built-in classifiers (4xx permanent, 5xx/429 transient).
import { RetryEngine } from '@backendkit-labs/retry';

export interface RetryOptions {
    maxRetries?: number;
    baseMs?:     number;
    maxMs?:      number;
    retryOn?:    (err: unknown) => boolean;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
    const engine = new RetryEngine({
        name: 'agent-protocol:withRetry',
        defaultConfig: {
            maxAttempts: (opts.maxRetries ?? 3) + 1,
            backoff: {
                type:      'exponential',
                baseDelay: opts.baseMs ?? 500,
                maxDelay:  opts.maxMs  ?? 16_000,
                jitter:    'full',
            },
            ...(opts.retryOn ? {
                retryIf: (payload: { cause?: unknown; message: string; status?: number }) => {
                    // Reconstruct original error for backward compat with retryOn(err) callers
                    const err = (payload.cause as Error | undefined)
                        ?? Object.assign(new Error(payload.message), { status: payload.status });
                    return opts.retryOn!(err);
                },
            } : {}),
        },
    });

    const result = await engine.execute(fn);
    if (!result.ok) {
        // Re-throw original cause when available, otherwise reconstruct
        throw (result.error.cause as Error | undefined)
            ?? Object.assign(new Error(result.error.message), { status: result.error.status });
    }
    return result.value;
}
