export interface RetryOptions {
    maxRetries?: number;
    baseMs?:     number;
    maxMs?:      number;
    retryOn?:    (err: unknown) => boolean;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function backoffMs(attempt: number, base: number, max: number): number {
    return Math.min(base * Math.pow(2, attempt), max);
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
    const { maxRetries = 3, baseMs = 500, maxMs = 16_000, retryOn } = opts;
    let lastErr: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (attempt === maxRetries) break;
            if (retryOn && !retryOn(err)) break;
            await sleep(backoffMs(attempt, baseMs, maxMs));
        }
    }

    throw lastErr;
}
