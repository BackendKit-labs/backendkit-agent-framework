import { retry } from '@backendkit-labs/retry';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;

export interface AvalToolsConfig {
    /** Where AVAL is reachable, e.g. "https://aval.internal" or "http://localhost:3000". */
    baseUrl: string;
    /**
     * Name of the credential inside ExecutionContext.secrets that holds this
     * agent's AVAL key (aval_sk_… or a JWT). Defaults to "AVAL_KEY" so most
     * callers never need to set this.
     */
    secretName?: string;
    timeoutMs?: number;
    maxAttempts?: number;
}

export interface AvalResponse<T> {
    status: number;
    ok: boolean;
    body: T;
}

/**
 * fetch() wrapper for AVAL, scoped to one call rather than one process: the
 * bearer token is a parameter, not baked into the client, because it's the
 * calling agent's own credential (ExecutionContext.secrets), not a shared
 * process-wide key.
 *
 * Unlike a generic HTTP client, 4xx responses are NOT thrown here — AVAL's 400
 * (denied), 401 (revoked/caducada), 403 (no es tuya), 404 (no existe) and 429
 * (límite) are meaningful domain answers a tool has to turn into text an agent
 * can act on, not transport failures. Only network errors and 5xx retry; only
 * those, and a response body that isn't JSON, throw.
 */
/** An error worth retrying (network failure, timeout, 5xx). Real Errors: a thrown plain object loses its message in `retry`. */
function transient(message: string): Error {
    return Object.assign(new Error(message), { transient: true });
}

export async function avalRequest<T>(
    config: AvalToolsConfig,
    token: string,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
): Promise<AvalResponse<T>> {
    const url = `${config.baseUrl.replace(/\/$/, '')}${path}`;
    const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const attempt = async (): Promise<AvalResponse<T>> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let res: Response;
        try {
            res = await fetch(url, {
                method,
                signal: controller.signal,
                headers: {
                    'content-type': 'application/json',
                    authorization: `Bearer ${token}`,
                },
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            });
        } catch (err) {
            clearTimeout(timer);
            const aborted = err instanceof Error && err.name === 'AbortError';
            throw transient(aborted
                ? `AVAL ${method} ${path} → timed out after ${timeoutMs}ms`
                : `AVAL ${method} ${path} → network error: ${(err as Error).message}`);
        }

        // The timer keeps running while the body is read: a server that sends headers and then stalls must not hang the tool.
        try {
            if (res.status >= 500) {
                throw transient(`AVAL ${method} ${path} → ${res.status}`);
            }

            const json = (await res.json().catch(() => undefined)) as T | undefined;
            if (json === undefined && controller.signal.aborted) {
                throw transient(`AVAL ${method} ${path} → timed out after ${timeoutMs}ms reading the response`);
            }
            return { status: res.status, ok: res.ok, body: (json ?? {}) as T };
        } finally {
            clearTimeout(timer);
        }
    };

    const result = await retry(attempt, {
        maxAttempts: config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        backoff: { type: 'exponential', baseDelay: 500, maxDelay: 4_000, jitter: 'full' },
        // `retry` hands retryIf its own wrapper of what was thrown: the original error is in `cause`.
        retryIf: (e: { cause?: unknown }) => (e.cause as { transient?: boolean } | undefined)?.transient === true,
    });

    if (!result.ok) throw new Error(result.error.message);
    return result.value;
}

/** Reads this agent's AVAL credential from its own secrets, never a shared env var. */
export function avalKey(config: AvalToolsConfig, secrets: Record<string, string> | undefined): string | null {
    return secrets?.[config.secretName ?? 'AVAL_KEY'] || null; // an empty value is no credential
}

/** What to tell the model when AVAL answers with something this tool does not understand: bounded, never the whole body. */
export function describeUnexpected(status: number, body: { error?: string }): string {
    const what = body.error ?? JSON.stringify(body) ?? '';
    return `respuesta inesperada de AVAL (${status}): ${what.length > 300 ? `${what.slice(0, 300)}…` : what}`;
}
