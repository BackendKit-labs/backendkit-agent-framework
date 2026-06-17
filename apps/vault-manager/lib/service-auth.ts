import { type NextRequest } from 'next/server';

/**
 * Checks if a request carries a valid service key.
 * Used by internal MCP agents (vault-manager-agent) that need to call
 * vault-manager APIs without a user session.
 *
 * Set VAULT_MANAGER_SERVICE_KEY in vault-manager's env.
 * The agent sends it as: X-Service-Key: <key>
 */
export function isServiceRequest(req: NextRequest): boolean {
    const key = process.env.VAULT_MANAGER_SERVICE_KEY;
    if (!key) return false;
    return req.headers.get('x-service-key') === key;
}
