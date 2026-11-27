import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { SessionRegistry } from './session-registry.js';

export function parseCliArgs(argv: string[] = process.argv.slice(2)): { httpMode: boolean; port: number } {
    const httpMode = argv.includes('--http');
    const portEq   = argv.find(a => a.startsWith('--port='))?.split('=')[1];
    const idx      = argv.indexOf('--port');
    const portArg  = portEq ?? (idx >= 0 ? argv[idx + 1] : undefined) ?? '3001';
    const port     = parseInt(portArg, 10);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`Invalid --port value: ${portArg}`);
    }
    return { httpMode, port };
}

/** A JSON-RPC request is small; a client that sends more than this is not one. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * The server binds to 127.0.0.1, but a web page in the user's browser can still reach it
 * (DNS rebinding / cross-site POST). Reject requests whose Host or Origin is not loopback.
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

/** Constant-time check of `Authorization: Bearer <token>`. */
export function isBearerAuthorized(header: string | undefined, token: string): boolean {
    if (!token || !header?.startsWith('Bearer ')) return false;
    const given    = Buffer.from(header.slice(7));
    const expected = Buffer.from(token);
    return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function runMcpServer(
    buildServer: () => McpServer,
    opts: { httpMode: boolean; port: number; label: string },
): Promise<void> {
    if (opts.httpMode) {
        await startHttp(buildServer, opts.port, opts.label, process.env.BK_MCP_AUTH_TOKEN || undefined);
    } else {
        const transport = new StdioServerTransport();
        await buildServer().connect(transport);
    }
}

/** @internal exported for tests */
export async function startHttp(
    buildServer: () => McpServer,
    port: number,
    label: string,
    authToken?: string,
): Promise<Server> {
    if (authToken !== undefined && authToken.trim() === '') throw new Error(`[${label}] authToken is empty: give a token or leave it out (loopback only)`);
    // Bounded and swept: a client that vanished without closing used to leave its transport behind for good (audit C-05).
    const sessions = new SessionRegistry<StreamableHTTPServerTransport>();
    const MCP_PATH = '/mcp';

    async function parseBody(req: IncomingMessage): Promise<unknown> {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
            size += (chunk as Buffer).length;
            if (size > MAX_BODY_BYTES) throw new Error(`request body is larger than ${MAX_BODY_BYTES} bytes`);
            chunks.push(chunk as Buffer);
        }
        const raw = Buffer.concat(chunks).toString('utf-8');
        if (!raw) return undefined;
        return JSON.parse(raw);
    }

    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        if (!isLoopbackRequest(req.headers.host, req.headers.origin)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden host or origin' }));
            return;
        }
        if (authToken && !isBearerAuthorized(req.headers.authorization, authToken)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }
        if (req.url !== MCP_PATH) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Use POST/GET ${MCP_PATH}` }));
            return;
        }
        try {
            const sessionId = req.headers['mcp-session-id'] as string | undefined;
            if (sessionId && sessions.has(sessionId)) {
                const body = req.method === 'POST' ? await parseBody(req) : undefined;
                await sessions.get(sessionId)!.handleRequest(req, res, body);
                return;
            }
            if (req.method !== 'POST') {
                res.writeHead(400);
                res.end('Session ID required for GET');
                return;
            }
            if (sessions.isFull()) {
                res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '60' });
                res.end(JSON.stringify({ error: 'Too many open sessions' }));
                return;
            }
            const body = await parseBody(req);
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
            });
            const srv = buildServer();
            await srv.connect(transport);
            await transport.handleRequest(req, res, body);
            if (transport.sessionId) {
                sessions.set(transport.sessionId, transport);
                transport.onclose = () => sessions.delete(transport.sessionId!);
            }
        } catch (err) {
            // ADR-0011: the client gets a status and a generic message; what went wrong goes to the server's log.
            const tooLarge = err instanceof Error && /larger than/.test(err.message);
            const [status, error] = tooLarge ? [413, 'Request body too large'] : err instanceof SyntaxError ? [400, 'Invalid JSON body'] : [500, 'Internal server error'];
            if (status === 500) process.stderr.write(`[${label}] request failed: ${err instanceof Error ? err.message : String(err)}\n`);
            if (!res.headersSent) {
                res.writeHead(status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error }));
            }
        }
    });

    await new Promise<void>((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, '127.0.0.1', () => {
            process.stderr.write(`[${label}] HTTP listening on http://127.0.0.1:${port}${MCP_PATH}\n`);
            resolve();
        });
    });
    return httpServer;
}
