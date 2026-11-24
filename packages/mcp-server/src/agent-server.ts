import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
    CallbackTransport,
    createToolRegistrar,
    type AgentEngine,
    type ToolDefinition,
    type ToolServerOptions,
} from '@backendkit-labs/agent-core';
import { isLoopbackRequest, readJsonBody, replyRequestError } from './request-guards.js';
import { SessionRegistry } from './session-registry.js';

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
    if (!header || !/^bearer /i.test(header)) return false;
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
    /** HTTP mode: a session idle for this long is closed. Default 30 min. */
    sessionTtlMs?: number;
    /** HTTP mode: new sessions get 503 once this many are open. Default 1000. */
    maxSessions?: number;
    /** Prompt tools: each call becomes a natural-language prompt run by a fresh engine. */
    tools?: AgentToolDef<any>[];
    /**
     * Factory called for every prompt-tool invocation.
     * Receives a fresh CallbackTransport so the agent's output can be captured.
     * Required when `tools` is not empty; a server with only `directTools` needs no engine.
     */
    engineFactory?: AgentEngineFactory;
    /**
     * Direct tools: `ToolDefinition`s (usually from `defineTool`) that run with no model in between. Served
     * by `createToolRegistrar` from agent-core, so they get the same guarantees as `createToolServer`:
     * schema validation, `authorize`, `audit`, output cap and `timeoutMs`. A name may not appear in both lists.
     */
    directTools?: ToolDefinition[];
    /** Yes/no gate for direct tools. A `destructive` direct tool needs this or `policy`. */
    authorize?: ToolServerOptions['authorize'];
    /** Policy for direct tools (allow, deny, ask), the same contract the engine uses (SPEC-0014). */
    policy?: ToolServerOptions['policy'];
    /** Answers an `ask` of the policy right away; its answer is validated before it counts. */
    approver?: ToolServerOptions['approver'];
    /** Who the approvers are and what roles they hold: a policy that asks with `approverRoles` is approved only by someone who holds one (SPEC-0041). */
    approverDirectory?: ToolServerOptions['approverDirectory'];
    /** Four eyes for direct tools: whoever the server acts for (`identity.userId`) does not approve the call either. */
    forbidSelfApproval?: boolean;
    /** Who the server acts for; part of the principal policies and audit events see. */
    identity?: ToolServerOptions['identity'];
    /**
     * The digital identity of the server for its direct tools (SPEC-0044): required by default, like in the engine. Without `agentIdentity` and
     * `identity.userId`, every direct call is denied and the reason says how to fix it. See `selfAssertedIdentities()` of agent-core.
     */
    agentIdentity?: ToolServerOptions['agentIdentity'];
    /** Default `true`. `false` lets direct tools run with no identity, for tests only. */
    requireAgentIdentity?: boolean;
    /** How long the identity provider has to answer before a direct call is denied. Default 5000. */
    agentIdentityTimeoutMs?: number;
    /** How long an answer of the provider is reused. Default 5000; `0` asks on every call. */
    agentIdentityCacheMs?: number;
    /** Default `true`: the audit events of direct calls are signed by the identity of the server when its provider can sign. */
    signAuditEvents?: boolean;
    /**
     * One record per direct-tool call (arguments as a hash).
     * @deprecated Use `auditSink`, which receives the engine's `AuditEvent`.
     */
    audit?: ToolServerOptions['audit'];
    /** One `AuditEvent` per direct-tool call, in call order. */
    auditSink?: ToolServerOptions['auditSink'];
    /** Context fields (or a builder) for direct tools. */
    context?: ToolServerOptions['context'];
    /** Output cap for direct tools. Default 1 048 576 characters. */
    maxOutputChars?: number;
    /** Time limit for direct tools that declare none. */
    toolTimeoutMs?: number;
}

/**
 * Wraps an AgentEngine as a full MCP server.
 *
 * Prompt tools (`tools`) translate their arguments into a natural-language prompt,
 * run it through the engine, and return the accumulated text response. Direct tools
 * (`directTools`) run their `execute` with the validated arguments, no model involved.
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
    private sessionRegistry?: SessionRegistry<StreamableHTTPServerTransport>;
    private readonly promptTools: AgentToolDef<any>[];
    private readonly registerDirectTools?: (server: McpServer) => void;

    constructor(private readonly opts: AgentMCPServerOptions) {
        this.promptTools = opts.tools ?? [];
        const directTools = opts.directTools ?? [];

        if (this.promptTools.length > 0 && !opts.engineFactory) {
            throw new Error(`[${opts.name}] prompt tools need an engineFactory`);
        }
        const promptNames = new Set<string>();
        for (const tool of this.promptTools) {
            if (promptNames.has(tool.name)) throw new Error(`[${opts.name}] duplicate tool name "${tool.name}"`);
            promptNames.add(tool.name);
        }
        for (const tool of directTools) {
            if (promptNames.has(tool.name)) {
                throw new Error(`[${opts.name}] tool "${tool.name}" is declared both as a prompt tool and as a direct tool`);
            }
        }
        if (directTools.length > 0) {
            // Validates now (names, declared facts, schemas, authorize for destructive tools), not at start().
            this.registerDirectTools = createToolRegistrar({
                name: opts.name,
                version: opts.version,
                tools: directTools,
                authorize: opts.authorize,
                policy: opts.policy,
                approver: opts.approver,
                ...(opts.approverDirectory ? { approverDirectory: opts.approverDirectory } : {}),
                ...(opts.forbidSelfApproval !== undefined ? { forbidSelfApproval: opts.forbidSelfApproval } : {}),
                identity: opts.identity,
                ...(opts.agentIdentity ? { agentIdentity: opts.agentIdentity } : {}),
                ...(opts.requireAgentIdentity !== undefined ? { requireAgentIdentity: opts.requireAgentIdentity } : {}),
                ...(opts.agentIdentityTimeoutMs !== undefined ? { agentIdentityTimeoutMs: opts.agentIdentityTimeoutMs } : {}),
                ...(opts.agentIdentityCacheMs !== undefined ? { agentIdentityCacheMs: opts.agentIdentityCacheMs } : {}),
                ...(opts.signAuditEvents !== undefined ? { signAuditEvents: opts.signAuditEvents } : {}),
                audit: opts.audit,
                auditSink: opts.auditSink,
                context: opts.context,
                maxOutputChars: opts.maxOutputChars,
                toolTimeoutMs: opts.toolTimeoutMs,
            });
        }
    }

    /** Start in HTTP mode (StreamableHTTP, stateful sessions). */
    async start(): Promise<void> {
        const sessions = new SessionRegistry<StreamableHTTPServerTransport>({
            ttlMs: this.opts.sessionTtlMs,
            maxSessions: this.opts.maxSessions,
        });
        this.sessionRegistry = sessions;

        const parseBody = (req: IncomingMessage): Promise<unknown> => readJsonBody(req);

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

                if (sessions.isFull()) {
                    res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '60' });
                    res.end(JSON.stringify({ error: 'Too many open sessions' }));
                    return;
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
                replyRequestError(res, err, line => process.stderr.write(`[${this.opts.name}] ${line}\n`));
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
        await this.sessionRegistry?.closeAll();
        this.sessionRegistry = undefined;
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

        this.registerDirectTools?.(srv);

        for (const tool of this.promptTools) {
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
            const engine = this.opts.engineFactory!(transport);
            engine.run(prompt).catch(reject);
        });
    }
}
