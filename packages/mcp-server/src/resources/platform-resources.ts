/**
 * MCP Resources — platform-level resources served by mcp-server.
 *
 * Each resource fetches from director-api at read time.
 * URIs follow the director:// scheme defined in ARCHITECTURE.md.
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
    // resources/list — filtered by ABAC
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (srv as any).server.setRequestHandler(
        { method: 'resources/list' } as never,
        async () => {
            const auth = await resolveResourceAuth(bearerToken);
            const visible = PLATFORM_RESOURCES.filter(r => auth.isAllowed(r.uri));
            return {
                resources: visible.map(r => ({
                    uri: r.uri,
                    name: r.name,
                    description: r.description,
                    mimeType: r.mimeType,
                })),
            };
        },
    );

    // resources/read — validate + fetch
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (srv as any).server.setRequestHandler(
        { method: 'resources/read' } as never,
        async (req: { params: { uri: string } }) => {
            const { uri } = req.params;
            const auth = await resolveResourceAuth(bearerToken);

            if (!auth.isAllowed(uri)) {
                throw new Error(`Access denied to resource: ${uri}`);
            }

            const def = PLATFORM_RESOURCES.find(r => r.uri === uri);
            if (!def) {
                throw new Error(`Unknown resource: ${uri}`);
            }

            const text = await def.fetch();
            return {
                contents: [{ uri, mimeType: def.mimeType, text }],
            };
        },
    );
}
