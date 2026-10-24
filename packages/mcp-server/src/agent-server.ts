import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { CallbackTransport, type AgentEngine } from '@backendkit-labs/agent-core';
import { isLoopbackRequest } from './request-guards.js';

type ZodRawShape = Record<string, z.ZodTypeAny>;

/**
 * A single tool exposed by the agent as an MCP tool.
 *
 * @example
 * {
 *   name: 'git_summarize',
 *   description: 'Summarize recent git commits',
 *   schema: { cwd: z.string().optional(), max: z.number().optional() },
 *   buildPrompt: ({ cwd, max }) => `Summarize the last ${max ?? 20} commits in ${cwd}.`,
 * }
 */
export interface AgentToolDef<S extends ZodRawShape = ZodRawShape> {
    name: string;
    description: string;
    /** Zod schema for the tool's input parameters */
    schema: S;
    /** Builds the natural-language prompt sent to the agent */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    buildPrompt: (args: any) => string;
}

/**
 * Factory that receives a pre-configured CallbackTransport and returns a
 * ready-to-run AgentEngine. Called once per tool invocation so each call
 * gets isolated state and a fresh output stream.
 *
 * @example
 * engineFactory: (transport) => createCodingEngineFromConfig({
 *   appName: 'my-agent',
 *   transport,
 * })
 */
export type AgentEngineFactory = (transport: CallbackTransport) => AgentEngine;

/** Constant-time check of an `Authorization: Bearer <token>` header. */
export function isAuthorized(header: string | undefined, token: string): boolean {
    if (!header?.startsWith('Bearer ')) return false;
    const given = Buffer.from(header.slice(7));
    const expected = Buffer.from(token);
    return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface AgentMCPServerOptions {
    /** Name shown in MCP tool namespaces: mcp:{name}:{tool} */
    name: string;
    version?: string;
    /** Port for HTTP mode. Default: 3001 */
    port?: number;
    /** Host to bind. Default: 127.0.0.1 */
    host?: string;
    /**
     * Static bearer token required on every HTTP request (`Authorization: Bearer <token>`).
     * Required when `host` is not a loopback address.
     */
    authToken?: string;
    tools: AgentToolDef<any>[];
    /**
     * Factory called for every tool invocation.
     * Receives a fresh CallbackTransport so the agent's output can be captured.
     */
    engineFactory: AgentEngineFactory;
}

/**
 * Wraps an AgentEngine as a full MCP server.
 *
 * Each registered tool translates its arguments into a natural-language prompt,
 * runs it through the engine, and returns the accumulated text response.
 *
 * Supports two modes:
 * - **HTTP** (`start()`) — `StreamableHTTPServerTransport`, stateful sessions
 * - **Stdio** (`startStdio()`) — for subprocess / pipe-based MCP clients
 *
 * @example
 * const server = new AgentMCPServer({
 *   name: 'git-analyst',
 *   port: 3010,
 *   tools: [{ name: 'git_summarize', ... }],
 *   engineFactory: (t) => createCodingEngineFromConfig({ transport: t }),
 * });
 * await server.start();            // HTTP
 * // await server.startStdio();   // stdio
 */
export class AgentMCPServer {
    private httpServer?: ReturnType<typeof createServer>;

    constructor(private readonly opts: AgentMCPServerOptions) {}

    /** Start in HTTP mode (StreamableHTTP, stateful sessions). */
    async start(): Promise<void> {
        const sessions = new Map<string, StreamableHTTPServerTransport>();

        const parseBody = async (req: IncomingMessage): Promise<unknown> => {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const raw = Buffer.concat(chunks).toString('utf-8');
            return raw ? JSON.parse(raw) : undefined;
        };

        const host = this.opts.host ?? '127.0.0.1';
        const port = this.opts.port ?? 3001;
        const token = this.opts.authToken;

        if (!token && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
            throw new Error(
                `[${this.opts.name}] refusing to listen on ${host} without authToken`,
            );
        }

        const loopbackBind = ['127.0.0.1', 'localhost', '::1'].includes(host);

        this.httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
            // bound to loopback, yet reachable from a web page in the user's browser (DNS rebinding / cross-site POST).
            // Only when bound to loopback: on another address the Host is legitimately not loopback (and a token is required).
            if (loopbackBind && !isLoopbackRequest(req.headers.host, req.headers.origin)) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Forbidden host or origin' }));
                return;
            }
            if (token && !isAuthorized(req.headers.authorization, token)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized' }));
                return;
            }

            if (req.url !== '/mcp') {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Use POST /mcp' }));
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
                    res.writeHead(400); res.end('Session ID required for GET'); return;
                }

                const body = await parseBody(req);
                const transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                });
                const srv = this.buildMcpServer();
                await srv.connect(transport);
                await transport.handleRequest(req, res, body);

                if (transport.sessionId) {
                    sessions.set(transport.sessionId, transport);
                    transport.onclose = () => sessions.delete(transport.sessionId!);
                }
            } catch (err) {
                if (!res.headersSent) { res.writeHead(500); res.end(String(err)); }
            }
        });

        await new Promise<void>((resolve, reject) => {
            this.httpServer!.once('error', reject);
            this.httpServer!.listen(port, host, () => {
                process.stderr.write(
                    `[${this.opts.name}] HTTP server listening on http://${host}:${port}/mcp\n`,
                );
                resolve();
            });
        });
    }

    /** Start in stdio mode (for subprocess / pipe-based MCP clients). */
    async startStdio(): Promise<void> {
        const transport = new StdioServerTransport();
        await this.buildMcpServer().connect(transport);
    }

    /** Gracefully shut down the HTTP server, force-closing open connections. */
    async stop(): Promise<void> {
        if (!this.httpServer) return;
        // closeAllConnections() drops keep-alive sockets immediately (Node 18.2+)
        if (typeof this.httpServer.closeAllConnections === 'function') {
            this.httpServer.closeAllConnections();
        }
        await new Promise<void>(resolve =>
            this.httpServer!.close(() => resolve())
        );
        this.httpServer = undefined;
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private buildMcpServer(): McpServer {
        const srv = new McpServer({
            name:    this.opts.name,
            version: this.opts.version ?? '1.0.0',
        });

        for (const tool of this.opts.tools) {
            srv.tool(tool.name, tool.description, tool.schema, async (args: Record<string, unknown>) => {
                const start   = Date.now();
                const preview = JSON.stringify(args).slice(0, 80);
                process.stderr.write(`[${this.opts.name}] ← ${tool.name}  ${preview}\n`);
                const prompt  = tool.buildPrompt(args);
                const result  = await this.runWithEngine(prompt);
                process.stderr.write(`[${this.opts.name}] → ${tool.name}  ${Date.now() - start}ms\n`);
                return { content: [{ type: 'text' as const, text: result }] };
            });
        }

        return srv;
    }

    /**
     * Creates a fresh engine via the factory (cheap — no network calls until run()),
     * runs the prompt, and returns the accumulated token output.
     */
    private runWithEngine(prompt: string): Promise<string> {
        return new Promise((resolve, reject) => {
            let output = '';
            const transport = new CallbackTransport((event) => {
                if (event.type === 'token') output += event.content;
                if (event.type === 'done')  resolve(output.trim() || '(no output)');
                if (event.type === 'error') reject(new Error(event.message));
            });
            const engine = this.opts.engineFactory(transport);
            engine.run(prompt).catch(reject);
        });
    }
}
