const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * A server bound to 127.0.0.1 can still be reached from a page in the user's browser (DNS rebinding, cross-site
 * POST). True only when the `Host` header and, if present, the `Origin` header are loopback.
 *
 * The single copy for packages that depend on agent-core (the MCP tool server here, `@backendkit-labs/mcp-server`).
 * `@backendkit-labs/mcp-connectors` keeps its own copy because it does not depend on agent-core; keep the two in
 * step (SPEC-0013 D6).
 */
export function isLoopbackRequest(host: string | undefined, origin: string | undefined): boolean {
    if (!host || !LOOPBACK_HOSTS.has(host.replace(/:\d+$/, '').toLowerCase())) return false;
    if (origin === undefined) return true; // non-browser clients send no Origin
    try {
        return LOOPBACK_HOSTS.has(new URL(origin).hostname.toLowerCase().replace(/^(::1)$/, '[::1]'));
    } catch {
        return false;
    }
}
