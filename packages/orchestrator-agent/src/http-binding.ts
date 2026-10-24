/**
 * Where the HTTP trigger listens. It starts runs with the operator's LLM keys, so it is loopback-only unless
 * the operator opts into a wider bind with ORCHESTRATOR_HTTP_HOST, and a wider bind requires an API key:
 * an unauthenticated trigger reachable from the network is refused, never started with a warning.
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export type HttpBinding =
    | { ok: true; host: string; loopback: boolean }
    | { ok: false; error: string };

export function resolveHttpBinding(env: Record<string, string | undefined>): HttpBinding {
    const host = env['ORCHESTRATOR_HTTP_HOST']?.trim() || '127.0.0.1';
    const loopback = LOOPBACK_HOSTS.has(host);
    if (!loopback && !env['ORCHESTRATOR_API_KEY']) {
        return {
            ok: false,
            error:
                `ORCHESTRATOR_HTTP_HOST=${host} is not loopback: set ORCHESTRATOR_API_KEY to expose the HTTP trigger, ` +
                'or remove ORCHESTRATOR_HTTP_HOST to listen on 127.0.0.1 only.',
        };
    }
    return { ok: true, host, loopback };
}
