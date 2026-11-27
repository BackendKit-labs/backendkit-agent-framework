import { retry } from '@backendkit-labs/retry';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;

export interface FetchJsonOptions {
    timeoutMs?: number;
    maxAttempts?: number;
    /**
     * Whether repeating the request is safe. Default: by method (GET/HEAD/OPTIONS/PUT/DELETE yes, POST/PATCH no).
     * Set it for a POST that only reads (JSON-RPC search) so it keeps its retries; a non-idempotent call that fails
     * with a 5xx, a timeout or a network error is NOT repeated, because the first attempt may have been applied
     * (a duplicated payslip, issue or contact). A 429 is always retried: the request was refused, not processed.
     */
    idempotent?: boolean;
}

/** What an error response may put in the message the model reads: the start of the body, not all of it. */
const MAX_ERROR_BODY_CHARS = 500;

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

/**
 * fetch() wrapper shared by connectors: hard timeout via AbortController, retry with
 * exponential backoff on network errors and 5xx, consistent 204 → undefined handling.
 *
 * Callers build url/init (including their own auth headers) — this only owns the
 * transport concern, so connectors with different auth schemes (Bearer, Basic,
 * dynamic OAuth token, session cookie) can all use it unchanged.
 */
export async function fetchJson<T>(
    serviceName: string,
    url: string,
    init: RequestInit,
    opts: FetchJsonOptions = {},
): Promise<T> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const method = init.method ?? 'GET';
    const idempotent = opts.idempotent ?? IDEMPOTENT_METHODS.has(method.toUpperCase());

    const attempt = async (): Promise<T> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let res: Response;
        try {
            res = await fetch(url, { ...init, signal: controller.signal });
        } catch (err) {
            clearTimeout(timer);
            // Duck-typed: the DOMException from an aborted fetch can come from another realm.
            const aborted = (err as { name?: string } | null)?.name === 'AbortError';
            // eslint-disable-next-line @typescript-eslint/no-throw-literal
            throw {
                type: 'network',
                message: aborted
                    ? `${serviceName} ${method} ${url.split('?')[0]} → timed out after ${timeoutMs}ms`
                    : `${serviceName} ${method} ${url.split('?')[0]} → network error: ${(err as Error).message}`,
            };
        }
        // The timer keeps running while the body is read: a server that sends headers and then stalls must not hang the call.
        try {
        if (res.status === 204) return undefined as T;
        if (!res.ok) {
            // A 4xx says what was wrong with the request the model made (a missing field): its start is kept, so the model can
            // fix it. A 5xx is the service's own failure and its body tends to carry internals (traces, hosts): only the status
            // goes on (audit C-11).
            const text = res.status < 500
                ? `: ${(await res.text().catch(() => '')).slice(0, MAX_ERROR_BODY_CHARS)}`
                : ` ${res.statusText || 'server error'}`;
            // eslint-disable-next-line @typescript-eslint/no-throw-literal
            throw {
                type: 'http',
                status: res.status,
                message: `${serviceName} ${method} ${url.split('?')[0]} → ${res.status}${text}`,
            };
        }
        return await (res.json() as Promise<T>);
        } finally {
            clearTimeout(timer);
        }
    };

    const result = await retry(attempt, {
        maxAttempts: opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        backoff: { type: 'exponential', baseDelay: 500, maxDelay: 8_000, jitter: 'full' },
        retryIf: (e: { type: string; status?: number }) =>
            (e.type === 'http' && e.status === 429) ||
            (idempotent && (e.type === 'network' || (e.type === 'http' && (e.status ?? 0) >= 500))),
        abortIf: (e: { type: string; status?: number }) =>
            e.type === 'http' && [401, 403].includes(e.status ?? 0),
    });

    if (!result.ok) {
        // The retry engine wraps what attempt() threw: its own `message` is generic
        // ("HTTP 404", or "[object Object]" for network errors); ours is in `cause`.
        const cause = result.error.cause as { message?: string; status?: number } | undefined;
        throw Object.assign(new Error(cause?.message ?? result.error.message), { status: cause?.status ?? result.error.status });
    }
    return result.value;
}
