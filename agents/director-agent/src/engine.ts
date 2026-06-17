import 'dotenv/config';
import * as path from 'node:path';
import {
    AgentEngine,
    AgentRegistry,
    ToolRegistry,
    ProviderRegistry,
    CallbackTransport,
    MCPClientManager,
} from '@backendkit-labs/agent-core';
import { initBkHome, bkPaths } from '@backendkit-labs/infra';
import type { AgentEvent, AgentProfile } from '@backendkit-labs/agent-core';
import type { DirectorConfig } from './config.js';
import { resolveAgentArgs } from './config.js';
import { DirectorProvider } from './provider.js';
import { loadSoul, buildSystemPrompt } from './soul.js';

// ── Director AgentProfile ─────────────────────────────────────────────────────

function buildDirectorProfile(systemPrompt: string, mcpToolNames: string[]): AgentProfile {
    return {
        id:          'director',
        name:        'Director',
        icon:        '◆',
        description: 'Brain of the BackendKit ecosystem. Calls MCP tools directly to answer and act.',
        systemPrompt,
        // Explicit list of MCP tools only — excludes ask_agent (no sub-agents to delegate to)
        allowedTools: mcpToolNames,
    };
}

// ── Engine factory ────────────────────────────────────────────────────────────

export interface DirectorRuntime {
    engine:     AgentEngine;
    mcp:        MCPClientManager;
    /** Registered provider name (e.g. 'deepseek') */
    provider:   string;
    model:      string;
}

export async function buildDirectorEngine(
    config:    DirectorConfig,
    configDir: string,
    onEvent?:  (evt: AgentEvent) => void,
): Promise<DirectorRuntime> {

    // Initialize ~/.backendkit/ on first run (idempotent)
    await initBkHome();

    const providerName = config.director.provider;
    const providerCfg  = config.providers[providerName];
    if (!providerCfg) {
        throw new Error(`Provider "${providerName}" not defined in director.yaml providers block`);
    }
    if (!providerCfg.api_key) {
        throw new Error(
            `API key for provider "${providerName}" is missing. ` +
            `Set the env var referenced in director.yaml (e.g. DEEPSEEK_API_KEY).`,
        );
    }

    // ── MCP: connect to all configured agents ─────────────────────────────────
    const mcpConfigs = config.agents.map(entry => ({
        name:    entry.name,
        command: entry.command,
        args:    resolveAgentArgs(entry, configDir),
        env:     entry.env,
    }));

    const mcp = new MCPClientManager(mcpConfigs);
    await mcp.initialize();

    const connectedServers = mcp.getServerInfo();
    const mcpTools     = mcp.getTools();
    const mcpToolNames = mcpTools.map(t => t.name);

    // ── Build system prompt from SOUL + live topology ─────────────────────────
    const soul     = loadSoul(configDir);
    const topology = connectedServers.map(s => ({
        name:      s.name,
        toolCount: s.toolCount,
        tools:     mcp.getServerTools(s.name).map(t => {
            // Strip the mcp__{name}__ prefix for readability in the system prompt
            const parts = t.name.split('__');
            return parts[parts.length - 1] ?? t.name;
        }),
    }));
    const systemPrompt = buildSystemPrompt(soul, topology);

    // ── Registries ────────────────────────────────────────────────────────────
    const tools = new ToolRegistry();
    for (const t of mcpTools) tools.register(t);

    const agents = new AgentRegistry();
    agents.register(buildDirectorProfile(systemPrompt, mcpToolNames));

    const providers = new ProviderRegistry();
    providers.register(providerName, new DirectorProvider({
        apiKey:   providerCfg.api_key,
        model:    providerCfg.model,
        baseUrl:  providerCfg.base_url,
    }));

    // ── Transport ─────────────────────────────────────────────────────────────
    const transport = new CallbackTransport((evt: AgentEvent) => {
        onEvent?.(evt);
    });

    // ── Engine ────────────────────────────────────────────────────────────────
    const engine = new AgentEngine({
        model:           { provider: providerName, id: providerCfg.model },
        agents,
        tools,
        providers,
        defaultProvider: providerName,
        defaultAgentId:  'director',
        transport,
        maxIterations:   config.director.max_iterations,
        iterationMode:   'auto',
    });

    return { engine, mcp, provider: providerName, model: providerCfg.model };
}

/** Resolves the director.yaml path: explicit arg > env var > default location. */
export function resolveConfigPath(arg?: string): string {
    if (arg)                            return path.resolve(arg);
    if (process.env.DIRECTOR_CONFIG)   return path.resolve(process.env.DIRECTOR_CONFIG);
    return path.resolve(import.meta.dirname, '..', 'director.yaml');
}
