import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { ToolDefinition } from '../types';
import type { MCPServerConfig } from './types';

type ServerState = 'pending' | 'connected' | 'failed';

interface ConnectedServer {
    config: MCPServerConfig;
    client: Client;
    tools: ToolDefinition[];
    transportUsed: string;
}

/**
 * Manages connections to multiple MCP servers and exposes their tools as
 * framework ToolDefinitions.
 *
 * Supports two connection modes:
 * - **Stdio** — spawns a local subprocess (command + args)
 * - **Remote** — connects over HTTP using StreamableHTTP with automatic SSE
 *   fallback for legacy servers (url field)
 *
 * Per-server state is tracked independently so a failed server doesn't block
 * others. Call reconnectFailed() to retry only the servers that are offline.
 *
 * Tool names are namespaced as `mcp__{safeName}__{originalToolName}` where
 * safeName replaces non-alphanumeric/dash/underscore characters with `_`.
 */
export class MCPClientManager {
    private servers: ConnectedServer[] = [];
    private serverStates = new Map<string, ServerState>();
    private initialized = false;
    private initPromise: Promise<void> | null = null;

    private disconnectHandler: ((serverName: string) => void) | null = null;

    constructor(private readonly configs: MCPServerConfig[]) {
        for (const cfg of configs) {
            this.serverStates.set(cfg.name, 'pending');
        }
    }

    /**
     * Register a callback that fires whenever a previously-connected server
     * drops its connection unexpectedly (process crash, network loss, etc.).
     * Called by MCPRegistrar to trigger tool/agent cleanup and schedule retry.
     */
    setDisconnectHandler(cb: (serverName: string) => void): void {
        this.disconnectHandler = cb;
    }

    /**
     * Establishes connections to all configured MCP servers.
     * Safe to call multiple times — subsequent calls are no-ops.
     * Individual server failures do not block others.
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;
        if (this.initPromise) return this.initPromise;
        this.initPromise = this.connectAll(this.configs);
        await this.initPromise;
        this.initialized = true;
    }

    /**
     * Retries only servers that previously failed or never connected.
     * Call this on subsequent engine.run() to reconnect offline agents.
     */
    async reconnectFailed(): Promise<void> {
        const failedConfigs = this.configs.filter(
            c => this.serverStates.get(c.name) !== 'connected',
        );
        if (failedConfigs.length > 0) {
            await this.connectAll(failedConfigs);
        }
    }

    /**
     * Restarts one or all agents.
     * If name is given: force-disconnects that agent (even if connected) then reconnects it.
     * If name is omitted: reconnects all currently-failed agents.
     * Returns the list of agent names now connected.
     */
    async restartAgent(name?: string): Promise<string[]> {
        if (name) {
            const cfg = this.configs.find(c => c.name === name);
            if (!cfg) throw new Error(`Agent "${name}" is not configured`);

            // Force-close if currently connected — suppress the auto disconnect handler
            const server = this.servers.find(s => s.config.name === name);
            if (server) {
                server.client.onclose = undefined;
                await server.client.close().catch(() => undefined);
                this.servers = this.servers.filter(s => s.config.name !== name);
            }
            this.serverStates.set(name, 'failed');
            await this.connectAll([cfg]);
        } else {
            await this.reconnectFailed();
        }

        return this.configs
            .filter(c => this.serverStates.get(c.name) === 'connected')
            .map(c => c.name);
    }

    /** All tools from all connected servers. */
    getTools(): ToolDefinition[] {
        return this.servers.flatMap(s => s.tools);
    }

    /** Tools for a specific connected server (empty if not connected). */
    getServerTools(serverName: string): ToolDefinition[] {
        return this.servers.find(s => s.config.name === serverName)?.tools ?? [];
    }

    /** Config for a server by name. */
    getConfig(serverName: string): MCPServerConfig | undefined {
        return this.configs.find(c => c.name === serverName);
    }

    /** Names of all configured servers regardless of connection state. */
    getConfiguredNames(): string[] {
        return this.configs.map(c => c.name);
    }

    /** Whether a server is currently connected. */
    isConnected(serverName: string): boolean {
        return this.serverStates.get(serverName) === 'connected';
    }

    /** Diagnostic summary of connected servers. */
    getServerInfo(): Array<{ name: string; transportUsed: string; toolCount: number }> {
        return this.servers.map(s => ({
            name:          s.config.name,
            transportUsed: s.transportUsed,
            toolCount:     s.tools.length,
        }));
    }

    /** Disconnects all MCP servers. */
    async disconnect(): Promise<void> {
        await Promise.allSettled(
            this.servers.map(s => {
                // Suppress onclose callbacks for intentional disconnects
                s.client.onclose = undefined;
                return s.client.close().catch(() => undefined);
            })
        );
        this.servers = [];
        for (const name of this.serverStates.keys()) {
            this.serverStates.set(name, 'pending');
        }
        this.initialized = false;
        this.initPromise = null;
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private async connectAll(configs: MCPServerConfig[]): Promise<void> {
        const results = await Promise.allSettled(
            configs.map(cfg => this.connectOne(cfg)),
        );
        for (let i = 0; i < results.length; i++) {
            const name = configs[i]?.name ?? `server-${i}`;
            if (results[i].status === 'rejected') {
                this.serverStates.set(name, 'failed');
                console.warn(
                    `[MCPClientManager] Failed to connect to "${name}": ` +
                    `${(results[i] as PromiseRejectedResult).reason}`,
                );
            } else {
                this.serverStates.set(name, 'connected');
            }
        }
    }

    private async connectOne(config: MCPServerConfig): Promise<void> {
        if (config.url) {
            await this.connectRemote(config);
        } else if (config.command) {
            await this.connectStdio(config);
        } else {
            throw new Error(
                `MCPServerConfig "${config.name}" requires either "url" (remote) or "command" (stdio)`,
            );
        }
    }

    /**
     * OS-level variables needed for subprocess execution.
     * Sensitive values (API keys, tokens, secrets) are intentionally excluded —
     * pass them explicitly via MCPServerConfig.env instead.
     */
    private static readonly SAFE_ENV_KEYS = new Set([
        'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE',
        'TERM', 'TMPDIR', 'TMP', 'TEMP', 'NODE_ENV', 'NODE_PATH', 'NODE_OPTIONS',
        // Windows
        'SystemRoot', 'WINDIR', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
        'ComSpec', 'PATHEXT', 'ProgramFiles', 'ProgramData', 'OS',
    ]);

    private getSafeEnv(): Record<string, string> {
        const result: Record<string, string> = {};
        for (const [key, value] of Object.entries(process.env)) {
            if (value !== undefined && MCPClientManager.SAFE_ENV_KEYS.has(key)) {
                result[key] = value;
            }
        }
        return result;
    }

    private async connectStdio(config: MCPServerConfig): Promise<void> {
        const transport = new StdioClientTransport({
            command: config.command!,
            args:    config.args ?? [],
            env:     { ...this.getSafeEnv(), ...(config.env ?? {}) } as Record<string, string>,
        });
        const client = this.buildClient();
        const timeoutMs = config.connectTimeoutMs ?? 120_000;
        await client.connect(transport, { timeout: timeoutMs });
        const tools = await this.discoverTools(config, client);
        this.servers.push({ config, client, tools, transportUsed: 'stdio' });
        client.onclose = () => { this.handleDisconnect(config.name); };
    }

    private async connectRemote(config: MCPServerConfig): Promise<void> {
        const url     = new URL(config.url!);
        const reqInit = config.headers ? { headers: config.headers } : undefined;

        if (config.remoteTransport === 'sse') {
            await this.connectSSE(config, url, reqInit);
            return;
        }
        try {
            await this.connectStreamableHTTP(config, url, reqInit);
        } catch (err) {
            if (config.remoteTransport === 'streamable-http' || !this.isHTTP4xx(err)) throw err;
            console.warn(
                `[MCPClientManager] "${config.name}": StreamableHTTP failed ` +
                `(${(err as Error).message}), falling back to SSE`,
            );
            await this.connectSSE(config, url, reqInit);
        }
    }

    private async connectStreamableHTTP(
        config: MCPServerConfig,
        url: URL,
        reqInit: RequestInit | undefined,
    ): Promise<void> {
        const transport = new StreamableHTTPClientTransport(url, { requestInit: reqInit });
        const client = this.buildClient();
        const timeoutMs = config.connectTimeoutMs ?? 15_000;
        await client.connect(transport, { timeout: timeoutMs });
        const tools = await this.discoverTools(config, client);
        this.servers.push({ config, client, tools, transportUsed: 'streamable-http' });
        client.onclose = () => { this.handleDisconnect(config.name); };
    }

    private async connectSSE(
        config: MCPServerConfig,
        url: URL,
        reqInit: RequestInit | undefined,
    ): Promise<void> {
        const transport: Transport = new SSEClientTransport(url, { requestInit: reqInit });
        const client = this.buildClient();
        const timeoutMs = config.connectTimeoutMs ?? 15_000;
        await client.connect(transport, { timeout: timeoutMs });
        const tools = await this.discoverTools(config, client);
        this.servers.push({ config, client, tools, transportUsed: 'sse' });
        client.onclose = () => { this.handleDisconnect(config.name); };
    }

    private handleDisconnect(serverName: string): void {
        if (this.serverStates.get(serverName) !== 'connected') return;
        this.serverStates.set(serverName, 'failed');
        this.servers = this.servers.filter(s => s.config.name !== serverName);
        this.disconnectHandler?.(serverName);
    }

    private buildClient(): Client {
        return new Client(
            { name: 'bk-agent-framework', version: '1.0.0' },
            { capabilities: {} },
        );
    }

    private async discoverTools(
        config: MCPServerConfig,
        client: Client,
    ): Promise<ToolDefinition[]> {
        const listResult = await client.listTools();
        return listResult.tools.map(t => this.wrapTool(config, client, t));
    }

    private isHTTP4xx(err: unknown): boolean {
        if (!err || typeof err !== 'object') return false;
        const code = (err as { code?: unknown }).code;
        if (typeof code === 'number' && code >= 400 && code < 500) return true;
        return /4\d{2}/.test((err as Error).message ?? '');
    }

    private wrapTool(
        config: MCPServerConfig,
        client: Client,
        mcpTool: { name: string; description?: string; inputSchema: unknown; annotations?: { readOnlyHint?: boolean } },
    ): ToolDefinition {
        // Function names must match ^[a-zA-Z0-9_-]+$ — replace ':' and use '__' as separator
        const safeName   = config.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const namespacedName = `mcp__${safeName}__${mcpTool.name}`;
        const timeoutMs = config.timeoutMs ?? 30_000;

        return {
            name: namespacedName,
            description: mcpTool.description
                ? `[MCP:${config.name}] ${mcpTool.description}`
                : `[MCP:${config.name}] ${mcpTool.name}`,
            parameters: (mcpTool.inputSchema as Record<string, unknown>) ?? {
                type: 'object',
                properties: {},
            },
            ...(config.trustAnnotations && mcpTool.annotations?.readOnlyHint === true ? { concurrencySafe: true } : {}),
            execute: async (args) => {
                let timerId: ReturnType<typeof setTimeout> | undefined;
                const timer = new Promise<never>((_, reject) => {
                    timerId = setTimeout(
                        () => reject(new Error(`MCP tool "${namespacedName}" timed out after ${timeoutMs}ms`)),
                        timeoutMs,
                    );
                });
                const call = client.callTool(
                    { name: mcpTool.name, arguments: args as Record<string, unknown> },
                    undefined,
                    // Without this, the MCP SDK's own request-level timeout (DEFAULT_REQUEST_TIMEOUT_MSEC,
                    // hardcoded 60s) fires before our own `timer` race ever gets a chance to matter for
                    // any timeoutMs configured above 60s — a tool that legitimately blocks server-side
                    // past 60s (e.g. a status-poll with a long wait_seconds) would error out at 60s
                    // regardless of what timeoutMs says. Pass it through so both layers agree.
                    { timeout: timeoutMs },
                );
                try {
                    const result = await Promise.race([call, timer]);
                    const textParts = (result.content as Array<{ type: string; text?: string }>)
                        .filter(b => b.type === 'text' && b.text)
                        .map(b => b.text!);
                    return textParts.length > 0 ? textParts.join('\n') : JSON.stringify(result.content);
                } finally {
                    clearTimeout(timerId);
                    // Absorb a late rejection from call to prevent unhandled promise rejection
                    call.catch(() => undefined);
                }
            },
        };
    }
}
