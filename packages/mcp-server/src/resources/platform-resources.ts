/**
 * MCP Resources — platform-level resources served by mcp-server.
 *
 * Each resource fetches from director-api at read time and is ABAC-gated
 * via abac-service. URIs follow the director:// scheme defined in ARCHITECTURE.md.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveResourceAuth } from './resource-auth.js';

const DIRECTOR_URL = process.env.DIRECTOR_URL ?? 'http://localhost:4000';
const DIRECTOR_API_KEY = process.env.DIRECTOR_API_KEY ?? '';

function directorHeaders(): Record<string, string> {
    return DIRECTOR_API_KEY ? { 'X-Api-Key': DIRECTOR_API_KEY } : {};
}

async function directorGet<T>(path: string): Promise<T> {
    const res = await fetch(`${DIRECTOR_URL}/api${path}`, {
        headers: directorHeaders(),
        signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`director-api ${res.status}: ${path}`);
    return res.json() as Promise<T>;
}

// ── Resource definitions ──────────────────────────────────────────────────────

interface ResourceDef {
    uri: string;
    name: string;
    description: string;
    mimeType: string;
    fetch: () => Promise<string>;
}

const PLATFORM_RESOURCES: ResourceDef[] = [
    {
        uri: 'director://workflows',
        name: 'Active Workflows',
        description: 'Lista de workflows activos en director-api con sus pasos y estado.',
        mimeType: 'application/json',
        fetch: async () => {
            const data = await directorGet<unknown[]>('/workflows');
            return JSON.stringify(data, null, 2);
        },
    },
    {
        uri: 'director://agents/health',
        name: 'Agent Health',
        description: 'Estado en tiempo real de todos los agentes desplegados.',
        mimeType: 'application/json',
        fetch: async () => {
            const data = await directorGet<unknown>('/director/status');
            return JSON.stringify(data, null, 2);
        },
    },
    {
        uri: 'director://deployables',
        name: 'Deployable Catalog',
        description: 'Catálogo completo de deployables (agentes y apps) registrados.',
        mimeType: 'application/json',
        fetch: async () => {
            const data = await directorGet<unknown[]>('/deployables');
            return JSON.stringify(data, null, 2);
        },
    },
];

// ── Registration ──────────────────────────────────────────────────────────────

export function registerPlatformResources(srv: McpServer, bearerToken?: string): void {
    for (const def of PLATFORM_RESOURCES) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (srv as any).resource(
            def.name,
            def.uri,
            { description: def.description, mimeType: def.mimeType },
            async (uri: URL) => {
                // ABAC check — evaluated lazily at read time so the JWT is fresh
                const auth = await resolveResourceAuth(bearerToken);
                if (!auth.isAllowed(uri.toString())) {
                    throw new Error(`Access denied to resource: ${uri}`);
                }

                const text = await def.fetch();
                return {
                    contents: [{ uri: uri.toString(), mimeType: def.mimeType, text }],
                };
            },
        );
    }
}
