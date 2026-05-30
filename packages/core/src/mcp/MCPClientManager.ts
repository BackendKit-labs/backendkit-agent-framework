import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { ToolDefinition } from '../types';
import type { MCPServerConfig } from './types';

interface ConnectedServer {
    config: MCPServerConfig;
    client: Client;
    tools: ToolDefinition[];
    /** 'stdio' | 'streamable-http' | 'sse' — for diagnostics */
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
 * Connections are established lazily on the first initialize() call so that
 * createBaseEngine() and createCodingEngine() stay synchronous.
 *
 * Tool names are namespaced as `mcp:{serverName}:{originalToolName}` to avoid
 * collisions across servers.
 */
export class MCPClientManager {
    private servers: ConnectedServer[] = [];
    private initialized = false;
    private initPromise: Promise<void> | null = null;

    constructor(private readonly configs: MCPServerConfig[]) {}

    /**
     * Establishes connections to all configured MCP servers and discovers their
     * tools. Safe to call multiple times — subsequent calls are no-ops.
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = this.connectAll();
        await this.initPromise;
        this.initialized = true;
    }

    /** Returns all tools from all connected servers. */
    getTools(): ToolDefinition[] {
        return this.servers.flatMap(s => s.tools);
    }

    /**
     * Returns a summary of connected servers for diagnostics (/mcp list, etc.).
     */
    getServerInfo(): Array<{ name: string; transportUsed: string; toolCount: number }> {
        return this.servers.map(s => ({
            name:          s.config.name,
            transportUsed: s.transportUsed,
            toolCount:     s.tools.length,
        }));
    }

    /** Disconnects all MCP servers. Call when the engine is destroyed. */
    async disconnect(): Promise<void> {
        await Promise.allSettled(
            this.servers.map(s => s.client.close().catch(() => undefined))
        );
        this.servers = [];
        this.initialized = false;
        this.initPromise = null;
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private async connectAll(): Promise<void> {
        const results = await Promise.allSettled(
            this.configs.map(cfg => this.connectOne(cfg))
        );

        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result.status === 'rejected') {
                const name = this.configs[i]?.name ?? `server-${i}`;
                console.warn(`[MCPClientManager] Failed to connect to "${name}": ${result.reason}`);
            }
        }
    }

    private async connectOne(config: MCPServerConfig): Promise<void> {
        if (config.url) {
            await this.connectRemote(config);
        } else if (config.command) {
            await this.connectStdio(config);
        } else {
            throw new Error(`MCPServerConfig "${config.name}" requires either "url" (remote) or "command" (stdio)`);
        }
    }

    // ── Stdio ─────────────────────────────────────────────────────────────────

    private async connectStdio(config: MCPServerConfig): Promise<void> {
        const transport = new StdioClientTransport({
            command: config.command!,
            args:    config.args ?? [],
            env:     { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
        });

        const client = this.buildClient();
        await client.connect(transport);

        const tools = await this.discoverTools(config, client);
        this.servers.push({ config, client, tools, transportUsed: 'stdio' });
    }

    // ── Remote (StreamableHTTP → SSE fallback) ────────────────────────────────

    private async connectRemote(config: MCPServerConfig): Promise<void> {
        const url        = new URL(config.url!);
        const reqInit    = config.headers ? { headers: config.headers } : undefined;

        // If the caller explicitly requested SSE, skip the StreamableHTTP attempt.
        if (config.remoteTransport === 'sse') {
            await this.connectSSE(config, url, reqInit);
            return;
        }

        // Default: try StreamableHTTP first, fall back to SSE on 4xx.
        try {
            await this.connectStreamableHTTP(config, url, reqInit);
        } catch (err) {
            const isClientError = this.isHTTP4xx(err);
            if (config.remoteTransport === 'streamable-http' || !isClientError) {
                throw err;
            }
            console.warn(
                `[MCPClientManager] "${config.name}": StreamableHTTP failed (${(err as Error).message}), ` +
                `falling back to SSE transport`,
            );
            await this.connectSSE(config, url, reqInit);
        }
    }

    private async connectStreamableHTTP(
        config: MCPServerConfig,
        url: URL,
        reqInit: RequestInit | undefined,
    ): Promise<void> {
        const transport = new StreamableHTTPClientTransport(url, {
            requestInit: reqInit,
        });
        const client = this.buildClient();
        await client.connect(transport);

        const tools = await this.discoverTools(config, client);
        this.servers.push({ config, client, tools, transportUsed: 'streamable-http' });
    }

    private async connectSSE(
        config: MCPServerConfig,
        url: URL,
        reqInit: RequestInit | undefined,
    ): Promise<void> {
        const transport: Transport = new SSEClientTransport(url, {
            requestInit: reqInit,
        });
        const client = this.buildClient();
        await client.connect(transport);

        const tools = await this.discoverTools(config, client);
        this.servers.push({ config, client, tools, transportUsed: 'sse' });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private buildClient(): Client {
        return new Client(
            { name: 'bk-agent-framework', version: '1.0.0' },
            { capabilities: {} },
        );
    }

    private async discoverTools(config: MCPServerConfig, client: Client): Promise<ToolDefinition[]> {
        const listResult = await client.listTools();
        return listResult.tools.map(t => this.wrapTool(config, client, t));
    }

    private isHTTP4xx(err: unknown): boolean {
        if (!err || typeof err !== 'object') return false;
        const code = (err as { code?: unknown }).code;
        if (typeof code === 'number' && code >= 400 && code < 500) return true;
        const msg = (err as Error).message ?? '';
        return /4\d{2}/.test(msg);
    }

    private wrapTool(
        config: MCPServerConfig,
        client: Client,
        mcpTool: { name: string; description?: string; inputSchema: unknown },
    ): ToolDefinition {
        const namespacedName = `mcp:${config.name}:${mcpTool.name}`;
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
            execute: async (args) => {
                const timer = new Promise<never>((_, reject) =>
                    setTimeout(
                        () => reject(new Error(`MCP tool "${namespacedName}" timed out after ${timeoutMs}ms`)),
                        timeoutMs,
                    )
                );

                const call = client.callTool({
                    name:      mcpTool.name,
                    arguments: args as Record<string, unknown>,
                });

                const result = await Promise.race([call, timer]);

                const textParts = (result.content as Array<{ type: string; text?: string }>)
                    .filter(block => block.type === 'text' && block.text)
                    .map(block => block.text!);

                return textParts.length > 0
                    ? textParts.join('\n')
                    : JSON.stringify(result.content);
            },
        };
    }
}
