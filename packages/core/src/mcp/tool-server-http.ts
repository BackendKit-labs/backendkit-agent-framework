import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createToolServerFactory, type ToolServerOptions } from './tool-server';

/**
 * Stateless Streamable HTTP for the MCP tool server (ADR: no sessions). Each POST gets its own `McpServer`
 * and transport, answers and closes. Direct tools keep no conversation state, so there is nothing to keep
 * between requests, nothing to expire and nothing that grows per client. The stateful variant with session
 * TTLs lives in `@backendkit-labs/mcp-server` for engines, which do have state.
 *
 * Fail-closed: a bearer token is required on every request, compared in constant time; without a token the
 * server refuses to listen anywhere but loopback. Bound to loopback, requests whose `Host` or `Origin` is not
 * loopback are rejected (DNS rebinding, cross-site POST from a page in the user's browser).
 */

export interface ToolServerHttpOptions {
    /** Default 3001 (0 picks a free port; read it back from the result). */
    port?: number;
    /** Default '127.0.0.1'. */
    host?: string;
    /** Static bearer token (`Authorization: Bearer <token>`). Required unless `host` is loopback. */
    authToken?: string;
    /** Request path. Default '/mcp'. */
    path?: string;
    /** Requests with a larger body get 413. Default 1 MiB. */
    maxBodyBytes?: number;
    /** Where startup and request errors are written. Default: stderr. */
    log?: (line: string) => void;
}

export interface RunningToolServer {
    url: string;
    port: number;
    close(): Promise<void>;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const LOOPBACK_BIND = new Set(['127.0.0.1', 'localhost', '::1']);
const DEFAULT_MAX_BODY_BYTES = 1_048_576;

/** Constant-time check of an `Authorization: Bearer <token>` header. */
export function isBearerAuthorized(header: string | undefined, token: string): boolean {
    if (!header || !/^bearer /i.test(header)) return false;
    const given = Buffer.from(header.slice(7).trim());
    const expected = Buffer.from(token);
    return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * The server binds to 127.0.0.1, but a page in the user's browser can still reach it (DNS rebinding,
 * cross-site POST). True only when both `Host` and, if present, `Origin` are loopback.
 * Same rule as `isLoopbackRequest` in `@backendkit-labs/mcp-server` and `mcp-connectors`.
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

/** Starts the tool server over stateless Streamable HTTP. Resolves once it is listening. */
export async function startToolServerHttp(
    tools: ToolServerOptions,
    http: ToolServerHttpOptions = {},
): Promise<RunningToolServer> {
    const host = http.host ?? '127.0.0.1';
    const port = http.port ?? 3001;
    const path = http.path ?? '/mcp';
    const token = http.authToken;
    const maxBodyBytes = http.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    const log = http.log ?? ((line: string) => process.stderr.write(`${line}\n`));
    const loopbackBind = LOOPBACK_BIND.has(host);

    if (!token && !loopbackBind) {
        throw new Error(`[${tools.name}] refusing to listen on ${host} without authToken`);
    }

    const buildServer = createToolServerFactory(tools); // validates the tools now, before listening

    const httpServer: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        if (loopbackBind && !isLoopbackRequest(req.headers.host, req.headers.origin)) {
            return reply(res, 403, { error: 'Forbidden host or origin' });
        }
        if (token && !isBearerAuthorized(req.headers.authorization, token)) {
            res.setHeader('WWW-Authenticate', 'Bearer');
            return reply(res, 401, { error: 'Unauthorized' });
        }
        if ((req.url ?? '').split('?')[0] !== path) {
            return reply(res, 404, { error: `Use POST ${path}` });
        }
        if (req.method !== 'POST') {
            // Without sessions there is no SSE stream to open (GET) nor a session to delete (DELETE).
            res.setHeader('Allow', 'POST');
            return reply(res, 405, { error: 'Method not allowed: this server is stateless, use POST' });
        }

        let body: unknown;
        try {
            body = await readJsonBody(req, maxBodyBytes);
        } catch (err) {
            if (err instanceof BodyTooLarge) return reply(res, 413, { error: `Request body exceeds ${maxBodyBytes} bytes` });
            return reply(res, 400, { error: 'Invalid JSON body' });
        }

        const server = buildServer();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined, // stateless
            enableJsonResponse: true,
        });
        res.on('close', () => {
            void transport.close();
            void server.close();
        });
        try {
            await server.connect(transport);
            await transport.handleRequest(req, res, body);
        } catch (err) {
            log(`[${tools.name}] request failed: ${err instanceof Error ? err.message : String(err)}`);
            if (!res.headersSent) reply(res, 500, { error: 'Internal server error' });
        }
    });

    await new Promise<void>((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => { httpServer.off('error', reject); resolve(); });
    });

    const actualPort = (httpServer.address() as AddressInfo).port;
    const url = `http://${host}:${actualPort}${path}`;
    log(`[${tools.name}] MCP tool server listening on ${url} (${tools.tools.length} tools)`);

    return {
        url,
        port: actualPort,
        close: () => new Promise<void>((resolve, reject) => {
            if (typeof httpServer.closeAllConnections === 'function') httpServer.closeAllConnections();
            httpServer.close(err => (err ? reject(err) : resolve()));
        }),
    };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

class BodyTooLarge extends Error {}

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        total += buf.length;
        if (total > maxBytes) throw new BodyTooLarge();
        chunks.push(buf);
    }
    if (chunks.length === 0) return undefined;
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function reply(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}
