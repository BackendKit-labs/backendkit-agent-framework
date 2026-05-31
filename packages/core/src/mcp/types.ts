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

    /** Timeout for individual tool calls in ms. Default: 30 000 */
    timeoutMs?: number;

    // ── Auto-generated agent profile ─────────────────────────────────────────

    /** Display name for the auto-generated agent entry. Default: title-cased server name. */
    agentName?: string;
    /** Description shown in the agent roster and used by the orchestrator to decide routing. */
    agentDescription?: string;
    /** Icon for the agent entry. Default: ◎ */
    icon?: string;

    // ── Direct routing ────────────────────────────────────────────────────────

    /**
     * Keywords that trigger direct routing to this MCP agent, bypassing the
     * orchestrator entirely. Matching is case-insensitive substring search on
     * the user input. When a match is found the engine calls this agent directly
     * without going through `general`.
     *
     * Use `toolTriggers` instead when you want to invoke a specific tool directly
     * (no intermediate LLM call). Plain `triggers` still routes through the agent's
     * own LLM session.
     *
     * @example
     * triggers: ["explicame", "explain"]
     */
    triggers?: string[];

    /**
     * Maps keywords to specific tool names on this MCP server. When a keyword
     * matches the user input, the corresponding tool is executed directly —
     * no LLM intermediary, no guessing.
     *
     * Tool name must match the short name (without the mcp__{server}__ prefix).
     *
     * @example
     * toolTriggers: {
     *   "explicame": "explain",
     *   "explain":   "explain",
     *   "review this": "review",
     *   "add docstring": "add_docstrings"
     * }
     */
    toolTriggers?: Record<string, string>;
}
