import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolDefinition } from '../types';
import type { MCPServerConfig } from './types';

interface ConnectedServer {
    config: MCPServerConfig;
    client: Client;
    tools: ToolDefinition[];
}

/**
 * Manages connections to multiple MCP servers and exposes their tools as
 * framework ToolDefinitions.
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
        const transport = new StdioClientTransport({
            command: config.command,
            args: config.args ?? [],
            env: { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
        });

        const client = new Client(
            { name: 'bk-agent-framework', version: '1.0.0' },
            { capabilities: {} },
        );

        await client.connect(transport);

        const listResult = await client.listTools();
        const tools = listResult.tools.map(t =>
            this.wrapTool(config, client, t)
        );

        this.servers.push({ config, client, tools });
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
                    setTimeout(() => reject(new Error(`MCP tool "${namespacedName}" timed out after ${timeoutMs}ms`)), timeoutMs)
                );

                const call = client.callTool({
                    name: mcpTool.name,
                    arguments: args as Record<string, unknown>,
                });

                const result = await Promise.race([call, timer]);

                // Extract text content from MCP response blocks
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
