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
            const aborted = err instanceof Error && err.name === 'AbortError';
            // eslint-disable-next-line @typescript-eslint/no-throw-literal
            throw {
                type: 'network',
                message: aborted
                    ? `AVAL ${method} ${path} → timed out after ${timeoutMs}ms`
                    : `AVAL ${method} ${path} → network error: ${(err as Error).message}`,
            };
        } finally {
            clearTimeout(timer);
        }

        if (res.status >= 500) {
            // eslint-disable-next-line @typescript-eslint/no-throw-literal
            throw { type: 'http', status: res.status, message: `AVAL ${method} ${path} → ${res.status}` };
        }

        const json = (await res.json().catch(() => ({}))) as T;
        return { status: res.status, ok: res.ok, body: json };
    };

    const result = await retry(attempt, {
        maxAttempts: config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        backoff: { type: 'exponential', baseDelay: 500, maxDelay: 4_000, jitter: 'full' },
        retryIf: (e: { type: string }) => e.type === 'network' || e.type === 'http',
    });

    if (!result.ok) throw new Error(result.error.message);
    return result.value;
}

/** Reads this agent's AVAL credential from its own secrets, never a shared env var. */
export function avalKey(config: AvalToolsConfig, secrets: Record<string, string> | undefined): string | null {
    return secrets?.[config.secretName ?? 'AVAL_KEY'] ?? null;
}
