import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

/**
 * Arranque de servidor MCP en modo stdio o HTTP.
 * Mismo patrón que packages/mcp-connectors/src/shared/server-runner.ts —
 * copiado en vez de importado porque este agente vive fuera de ese paquete.
 */

export function parseCliArgs(): { httpMode: boolean; port: number } {
    const args = process.argv.slice(2);
    const httpMode = args.includes('--http');
    const portEq = args.find((a) => a.startsWith('--port='))?.split('=')[1];
    const portSpace = args[args.indexOf('--port') + 1];
    const port = parseInt(portEq ?? portSpace ?? '3002', 10);
    return { httpMode, port };
}

export async function runMcpServer(
    buildServer: () => McpServer,
    opts: { httpMode: boolean; port: number; label: string },
): Promise<void> {
    if (opts.httpMode) {
        await startHttp(buildServer, opts.port, opts.label);
    } else {
        const transport = new StdioServerTransport();
        await buildServer().connect(transport);
    }
}

async function startHttp(buildServer: () => McpServer, port: number, label: string): Promise<void> {
    const sessions = new Map<string, StreamableHTTPServerTransport>();
    const MCP_PATH = '/mcp';

    async function parseBody(req: IncomingMessage): Promise<unknown> {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const raw = Buffer.concat(chunks).toString('utf-8');
        if (!raw) return undefined;
        return JSON.parse(raw);
    }

    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
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
            if (!res.headersSent) {
                res.writeHead(500);
                res.end(String(err));
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
}
