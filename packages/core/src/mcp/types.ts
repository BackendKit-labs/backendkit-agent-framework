/**
 * Configuration for a single MCP server connection.
 *
 * Two modes are supported:
 *
 * **Stdio** — spawns a local subprocess:
 * ```json
 * { "name": "github", "command": "npx", "args": ["@modelcontextprotocol/server-github"],
 *   "env": { "GITHUB_TOKEN": "ghp_..." } }
 * ```
 *
 * **Remote** — connects over HTTP (StreamableHTTP with SSE fallback):
 * ```json
 * { "name": "my-service", "url": "https://mcp.myservice.com/v1",
 *   "headers": { "Authorization": "Bearer tok_..." } }
 * ```
 *
 * When both `url` and `command` are provided, `url` (remote) takes priority.
 */
export interface MCPServerConfig {
    /** Human-readable identifier — used to namespace tool names: mcp__{safeName}__{tool} */
    name: string;

    // ── Stdio transport (local subprocess) ───────────────────────────────────

    /** Executable to spawn (e.g. 'node', 'npx', 'python'). Required for stdio mode. */
    command?: string;
    /** Arguments passed to the command. */
    args?: string[];
    /** Extra environment variables merged with process.env. */
    env?: Record<string, string>;

    // ── Remote transport (HTTP) ───────────────────────────────────────────────

    /**
     * HTTP endpoint of the remote MCP server.
     * When set, the client connects via StreamableHTTP with automatic SSE fallback.
     */
    url?: string;
    /**
     * HTTP headers sent on every request (e.g. Authorization, API keys).
     * Values are passed as-is — merge secrets from environment variables before
     * building the config.
     */
    headers?: Record<string, string>;
    /**
     * Force a specific remote transport instead of using auto-detection.
     * - `'streamable-http'` — MCP Streamable HTTP (current spec, default)
     * - `'sse'`             — legacy SSE transport (deprecated, pre-2025 servers)
     *
     * When omitted the client tries Streamable HTTP first and falls back to SSE
     * automatically if the server returns 4xx on the initial request.
     */
    remoteTransport?: 'streamable-http' | 'sse';

    // ── Shared ────────────────────────────────────────────────────────────────

    /**
     * Believe what this server says about its tools: `readOnlyHint`, `destructiveHint`, `idempotentHint`,
     * `openWorldHint` and `_meta` become the tool's facts. Off by default: what a server says about its tools
     * is a claim, and a tool with no facts counts as one with effect (it asks, and `read-only` refuses it).
     * `toolFacts` overrides it per tool.
     */
    trustAnnotations?: boolean;

    /**
     * Facts about this server's tools that you state yourself, by the tool's name on the server (not
     * `mcp__server__tool`). They win over the server's annotations, trusted or not: a server cannot make a tool
     * you marked `destructive` stop asking a person. A `destructive: true` here clears `readOnly`, and a
     * `readOnly: true` clears `destructive`. Lets you trust one tool as read-only without `trustAnnotations`.
     *
     * @example
     * toolFacts: { list_invoices: { readOnly: true }, pay_invoice: { destructive: true } }
     */
    toolFacts?: Record<string, MCPToolFacts>;

    /**
     * The definitions of this server's tools you accepted, as `{ toolName: fingerprint }`. When set, a tool
     * whose definition (name, title, description, input schema, annotations) no longer has that fingerprint is
     * left out with a warning, and so is a tool not listed: a server cannot change what a tool says to the
     * model, or add a new one, without you accepting it again. Get the fingerprints with
     * `MCPClientManager.toolFingerprints(server)` or `mcpToolFingerprint(tool)`. Unset: no pinning.
     */
    pinnedTools?: Record<string, string>;

    /** Timeout for individual tool calls in ms. Default: 30 000 */
    timeoutMs?: number;
    /**
     * Timeout for the initial MCP handshake (connect + initialize) in ms.
     * Increase this when the server process has a slow cold start (e.g. npx downloads).
     * Default: 60 000 for stdio, 15 000 for remote.
     */
    connectTimeoutMs?: number;

    // ── Auto-generated agent profile ─────────────────────────────────────────

    /** Display name for the auto-generated agent entry. Default: title-cased server name. */
    agentName?: string;
    /** Description shown in the agent roster and used by the orchestrator to decide routing. */
    agentDescription?: string;
    /** Icon for the agent entry. Default: ◎ */
    icon?: string;

    // ── Integration mode ──────────────────────────────────────────────────────

    /**
     * How the MCP server is integrated into the agent system.
     *
     * **'tools'** (default) — The MCP tools are registered directly in the
     * ToolRegistry and assigned to the agents listed in `assignTo`. No wrapper
     * agent is created. The specialist that already has project context composes
     * the external capability inline — one LLM hop, full project awareness.
     * Use this for: APIs, databases, side-effect services (GitHub, Postgres, Slack).
     *
     * **'agent'** — A wrapper agent is created in the roster and the orchestrator
     * can delegate to it via ask_agent. Use only when the remote service has its
     * own reasoning layer (e.g. a deep-research service, a specialist from another
     * org) or when the tool output is so large it needs its own summarization turn.
     *
     * @default 'tools'
     */
    mode?: 'tools' | 'agent';

    /**
     * When mode='tools': which local agent IDs receive these MCP tools in their
     * allowedTools list. The tools become callable by those agents during execution.
     *
     * When omitted or empty: tools are assigned to ALL registered agents.
     *
     * Has no effect when mode='agent'.
     *
     * @example
     * assignTo: ['backend', 'data']    // only backend and data can use these tools
     * assignTo: ['*']                  // same as omitting — all agents
     */
    assignTo?: string[];

    /**
     * Shell binaries to block on agents in assignTo while this MCP server is
     * connected. Forces those agents to use the MCP tools instead of equivalent
     * shell commands. Automatically unblocked when the server disconnects or is
     * removed — agents fall back to the shell commands transparently.
     *
     * Has no effect when mode='agent'.
     *
     * @example
     * blocksCommands: ['docker', 'docker-compose']
     * // data and backend cannot run docker directly — they must use pg_create
     */
    blocksCommands?: string[];

    // ── Direct routing ────────────────────────────────────────────────────────

    /**
     * Keywords that trigger direct routing to this MCP server, bypassing the
     * orchestrator entirely. In mode='agent' routes to the wrapper agent's LLM
     * session. In mode='tools' has no effect (use toolTriggers for direct calls).
     *
     * @example
     * triggers: ["deploy now", "rollback"]
     */
    triggers?: string[];

    /**
     * Maps keywords to specific tool names on this MCP server. When a keyword
     * matches the user input, the corresponding tool is executed directly —
     * zero LLM calls. Works in both modes.
     *
     * Tool name must match the short name (without the mcp__{server}__ prefix).
     *
     * @example
     * toolTriggers: { "explicame": "explain", "review this": "review" }
     */
    toolTriggers?: Record<string, string>;
}

/** Facts about a server's tool that the client states itself (`MCPServerConfig.toolFacts`). */
export interface MCPToolFacts {
    readOnly?: boolean;
    destructive?: boolean;
    idempotent?: boolean;
    openWorld?: boolean;
}
