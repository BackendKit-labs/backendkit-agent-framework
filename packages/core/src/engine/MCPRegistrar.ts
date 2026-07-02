import type { MCPClientManager } from '../mcp/MCPClientManager';
import type { MCPServerConfig } from '../mcp/types';
import type { AgentRegistry } from './AgentRegistry';
import type { ToolRegistry } from './ToolRegistry';
import type { Transport } from '../transport/Transport';
import type { ToolDefinition } from '../types';

export interface MCPRegistrarOptions {
    mcpManager: MCPClientManager | undefined;
    tools: ToolRegistry;
    agents: AgentRegistry;
    transport: Transport;
}

export class MCPRegistrar {
    private mcpInitialized = false;
    private mcpInitAttempts = 0;
    private readonly mcpRegisteredServers = new Set<string>();
    private readonly mcpTriggers = new Map<string, string[]>();
    private readonly mcpToolTriggers = new Map<string, { agentId: string; tool: string }>();
    private readonly mcpAgentBlocks = new Map<string, Array<{
        agentId: string;
        toolNames: string[];
        blockedCmds: string[];
    }>>();

    constructor(private readonly opts: MCPRegistrarOptions) {
        opts.mcpManager?.setDisconnectHandler(name => this.handleServerDisconnect(name));
    }

    private handleServerDisconnect(serverName: string): void {
        if (this.mcpRegisteredServers.has(serverName)) {
            this.unregisterServer(serverName);
        }
        // Reset attempt counter so crash-recovery gets a fresh retry budget
        this.mcpInitAttempts = 0;
    }

    async ensureInitialized(): Promise<void> {
        if (!this.opts.mcpManager) return;

        try {
            if (!this.mcpInitialized) {
                await this.opts.mcpManager.initialize();
                this.mcpInitialized = true;
            } else {
                const offline = this.opts.mcpManager.getConfiguredNames()
                    .filter(n => !this.mcpRegisteredServers.has(n));
                if (offline.length > 0 && this.mcpInitAttempts < 3) {
                    this.mcpInitAttempts++;
                    await this.opts.mcpManager.reconnectFailed();
                }
            }
        } catch (err) {
            this.opts.transport.emit({
                type: 'system', level: 'warn',
                text: `MCP initialization error: ${(err as Error).message}`,
            });
        }

        for (const { name, toolCount } of this.opts.mcpManager.getServerInfo()) {
            if (toolCount > 0 && !this.mcpRegisteredServers.has(name)) {
                const tools  = this.opts.mcpManager.getServerTools(name);
                const config = this.opts.mcpManager.getConfig(name);
                if (!config) {
                    // Server disconnected between getServerInfo() and getConfig() — skip this
                    // cycle, it will be picked up again once reconnected (or reported offline below).
                    this.opts.transport.emit({
                        type: 'system', level: 'warn',
                        text: `MCP server "${name}" config unavailable during registration — will retry.`,
                    });
                    continue;
                }
                this.registerAgent(config, tools);
                this.mcpRegisteredServers.add(name);
            }
        }

        const stillOffline = this.opts.mcpManager.getConfiguredNames()
            .filter(n => !this.mcpRegisteredServers.has(n));
        if (stillOffline.length > 0) {
            const retriesLeft = 3 - this.mcpInitAttempts;
            const suffix = retriesLeft > 0
                ? `Retrying on next message (${retriesLeft} attempts left).`
                : `No more automatic retries — call engine.getMCPManager()?.reconnectFailed() to retry manually.`;
            this.opts.transport.emit({
                type: 'system', level: 'warn',
                text: `MCP agents offline: ${stillOffline.join(', ')} — start their servers to enable them. ${suffix}`,
            });
        }
    }

    findRoute(input: string): { agentId: string; tool?: string } | undefined {
        const lower = input.toLowerCase();
        for (const [keyword, route] of this.mcpToolTriggers) {
            if (lower.includes(keyword)) return route;
        }
        for (const [agentId, triggers] of this.mcpTriggers) {
            if (triggers.some(t => lower.includes(t.toLowerCase()))) return { agentId };
        }
        return undefined;
    }

    unregisterServer(serverName: string): void {
        const safeName = serverName.replace(/[^a-zA-Z0-9_-]/g, '_');

        const records = this.mcpAgentBlocks.get(safeName) ?? [];
        for (const { agentId, toolNames, blockedCmds } of records) {
            const agent = this.opts.agents.get(agentId);
            if (agent) {
                this.opts.agents.upsert({
                    ...agent,
                    allowedTools: agent.allowedTools.filter(t => !toolNames.includes(t)),
                    blockedCommands: (agent.blockedCommands ?? []).filter(c => !blockedCmds.includes(c)),
                });
            }
            for (const toolName of toolNames) {
                this.opts.tools.unregister(toolName);
            }
        }
        this.mcpAgentBlocks.delete(safeName);

        this.opts.agents.delete(safeName);

        this.mcpTriggers.delete(safeName);
        for (const [keyword, route] of this.mcpToolTriggers) {
            if (route.agentId === safeName) this.mcpToolTriggers.delete(keyword);
        }
        this.mcpRegisteredServers.delete(serverName);

        this.opts.transport.emit({
            type: 'system', level: 'info',
            text: `[MCP:${serverName}] unregistered — tools removed, commands unblocked.`,
        });
    }

    registerAgent(config: MCPServerConfig, tools: ToolDefinition[]): void {
        const safeName = config.name.replace(/[^a-zA-Z0-9_-]/g, '_');

        for (const tool of tools) {
            if (!this.opts.tools.has(tool.name)) {
                this.opts.tools.register(tool);
            }
        }

        if (config.toolTriggers) {
            for (const [keyword, tool] of Object.entries(config.toolTriggers)) {
                this.mcpToolTriggers.set(keyword.toLowerCase(), { agentId: safeName, tool });
            }
        }

        const mode = config.mode ?? 'tools';
        if (mode === 'tools') {
            this.registerToolPack(config, tools, safeName);
        } else {
            this.registerAgentWrapper(config, tools, safeName);
        }
    }

    /**
     * mode='tools' (default): assigns MCP tools directly to local agent allowedTools.
     * Also applies blocksCommands to those agents while the server is connected —
     * forcing them to use the MCP tools instead of equivalent shell commands.
     * Both tool assignments and command blocks are tracked so they can be
     * fully reverted when the server disconnects via unregisterServer().
     */
    private registerToolPack(config: MCPServerConfig, tools: ToolDefinition[], safeName: string): void {
        const toolNames = tools.map(t => t.name);
        const blocksCommands = config.blocksCommands ?? [];

        const assignTo = config.assignTo?.filter(id => id !== '*') ?? [];
        const targets = assignTo.length > 0
            ? assignTo
            : this.opts.agents.getAll().map(a => a.id);

        const blockRecord: Array<{ agentId: string; toolNames: string[]; blockedCmds: string[] }> = [];

        for (const agentId of targets) {
            const agent = this.opts.agents.get(agentId);
            if (!agent) {
                this.opts.transport.emit({
                    type: 'system', level: 'warn',
                    text: `[MCP:${config.name}] assignTo agent "${agentId}" not found — skipped.`,
                });
                continue;
            }
            this.opts.agents.upsert({
                ...agent,
                allowedTools: [...new Set([...agent.allowedTools, ...toolNames])],
                blockedCommands: [...new Set([...(agent.blockedCommands ?? []), ...blocksCommands])],
            });
            blockRecord.push({ agentId, toolNames, blockedCmds: blocksCommands });
        }

        this.mcpAgentBlocks.set(safeName, blockRecord);

        if (config.triggers?.length) {
            this.opts.transport.emit({
                type: 'system', level: 'warn',
                text: `[MCP:${config.name}] 'triggers' is ignored in mode='tools'. Use 'toolTriggers' for direct keyword routing.`,
            });
        }

        const shortNames = tools.map(t => t.name.split('__')[2] ?? t.name).join(', ');
        const agentList = targets.join(', ') || 'all agents';
        const blockedLabel = blocksCommands.length ? `  blocked: [${blocksCommands.join(', ')}]` : '';
        this.opts.transport.emit({
            type: 'system', level: 'info',
            text: `[MCP:${config.name}] tools [${shortNames}] assigned to: ${agentList}${blockedLabel}`,
        });
    }

    /**
     * mode='agent': wraps the MCP server as a delegatable agent in the roster.
     * Use only when the remote service has its own reasoning layer or its output
     * is so large it needs a dedicated summarization turn.
     */
    private registerAgentWrapper(config: MCPServerConfig, tools: ToolDefinition[], safeName: string): void {
        const toolList = tools
            .map(t => {
                const shortName = t.name.split('__')[2] ?? t.name;
                const desc = t.description.replace(/^\[MCP:[^\]]+\]\s*/, '').slice(0, 80);
                return `- ${shortName}: ${desc}`;
            })
            .join('\n');

        const enrichedDesc = tools
            .map(t => {
                const shortName = t.name.split('__')[2] ?? t.name;
                const desc = t.description.replace(/^\[MCP:[^\]]+\]\s*/, '').slice(0, 70);
                return `${shortName}: ${desc}`;
            })
            .join(' | ');

        this.opts.agents.upsert({
            id:           safeName,
            name:         config.agentName ?? toTitleCase(config.name),
            icon:         config.icon ?? '◎',
            description:  config.agentDescription ?? `External specialist — ${enrichedDesc}`,
            systemPrompt:
                `You are a specialized remote agent: ${config.name}.\n` +
                `Use ONLY your available tools to answer the request. ` +
                `Do NOT use run_command, read_file, or other local tools.\n\n` +
                `Your tools:\n${toolList}`,
            allowedTools: tools.map(t => t.name),
            source:       'mcp',
        });

        if (config.triggers?.length) {
            this.mcpTriggers.set(safeName, config.triggers);
        }
    }
}

function toTitleCase(s: string): string {
    return s
        .replace(/[-_](.)/g, (_, c: string) => ' ' + c.toUpperCase())
        .replace(/^(.)/, (c: string) => c.toUpperCase());
}
