import 'dotenv/config';
import * as path from 'node:path';
import {
    AgentEngine,
    AgentRegistry,
    ToolRegistry,
    ProviderRegistry,
    CallbackTransport,
    MCPClientManager,
    createMemorySystem,
} from '@backendkit-labs/agent-core';
import { initBkHome, bkPaths } from '@backendkit-labs/infra';
import type { AgentEvent, AgentProfile, ToolDefinition } from '@backendkit-labs/agent-core';
import type { DirectorConfig } from './config.js';
import { resolveAgentArgs } from './config.js';
import { DirectorProvider } from './provider.js';
import { loadSoul, buildSystemPrompt } from './soul.js';
import { PolicyEngine }                 from './auth/policy.js';
import { VaultFilter }                  from './auth/vault-filter.js';
import { AuditLogger, buildAuditPath }  from './auth/audit.js';
import { requestContext, type RequestContext } from './auth/context.js';
import { ADMIN_PRINCIPAL } from './auth/types.js';

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
    engine:       AgentEngine;
    mcp:          MCPClientManager;
    /** Registered provider name (e.g. 'deepseek') */
    provider:     string;
    model:        string;
    policyEngine: PolicyEngine | null;
    vaultFilter:  VaultFilter | null;
    auditLogger:  AuditLogger | null;
}

// ── Helpers compartidos ───────────────────────────────────────────────────────

const VAULT_FILTER_TOOLS = new Set(['read_note', 'search_vault']);

function shortToolName(fullName: string): string {
    return fullName.split('__').at(-1) ?? fullName;
}

function principal() {
    return (requestContext.getStore() as RequestContext | undefined)?.principal ?? ADMIN_PRINCIPAL;
}

function rawArgs(args: unknown): Record<string, unknown> {
    return (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
}

// ── Capa 2+3: RBAC + ABAC guard ──────────────────────────────────────────────
//
// Loguea para herramientas NO-vault (vault tools las loguea applyVaultFilter).
// Esto garantiza exactamente UNA entrada de auditoría por llamada a tool.

function guardTool(
    tool:  ToolDefinition,
    policy: PolicyEngine,
    audit:  AuditLogger | null,
): ToolDefinition {
    const short    = shortToolName(tool.name);
    const isVault  = VAULT_FILTER_TOOLS.has(short);

    return {
        ...tool,
        execute: async (args, ctx) => {
            const start = Date.now();
            const p     = principal();
            const a     = rawArgs(args);
            const auth  = policy.authorize(p, tool.name, a);

            if (!auth.allowed) {
                if (!isVault) audit?.write({
                    ts: new Date().toISOString(), userId: p.id, role: p.role,
                    department: p.department, tool: short,
                    decision: 'denied', layer: auth.layer, reason: auth.reason,
                    durationMs: Date.now() - start,
                });
                return auth.reason ?? policy.denyMessage(p, tool.name);
            }

            const result = await tool.execute(args, ctx);

            if (!isVault) audit?.write({
                ts: new Date().toISOString(), userId: p.id, role: p.role,
                department: p.department, tool: short,
                decision: 'allowed', durationMs: Date.now() - start,
            });

            return result;
        },
    };
}

// ── Capa 4: vault filter + auditoría de vault ─────────────────────────────────
//
// Envuelve la tool YA guardada. Loguea las decisiones de vault (read_note
// denegado por path, search_vault con resultados filtrados).

function applyVaultFilter(
    tool:  ToolDefinition,
    filter: VaultFilter,
    audit:  AuditLogger | null,
): ToolDefinition {
    const short = shortToolName(tool.name);
    if (!VAULT_FILTER_TOOLS.has(short)) return tool;

    return {
        ...tool,
        execute: async (args, ctx) => {
            const start = Date.now();
            const p     = principal();
            const a     = rawArgs(args);

            // read_note: check path ANTES de llamar a la tool guardada
            if (short === 'read_note') {
                const notePath = filter.extractPathArg(a);
                if (notePath && !filter.isPathAllowed(p, notePath)) {
                    const reason = filter.denyReadMessage(p, notePath);
                    audit?.write({
                        ts: new Date().toISOString(), userId: p.id, role: p.role,
                        department: p.department, tool: short,
                        decision: 'denied', layer: 'vault', reason,
                        durationMs: Date.now() - start,
                        extra: { vaultPath: notePath },
                    });
                    return reason;
                }
            }

            // Llama la tool guardada (guardTool NO loguea para vault tools)
            const result = await tool.execute(args, ctx);

            if (short === 'search_vault') {
                const filtered = filter.filterSearchResults(p, result);

                // Calcula cuántos resultados fueron filtrados
                let filteredCount = 0;
                try {
                    const orig = JSON.parse(result) as { results?: unknown[] };
                    const filt = JSON.parse(filtered) as { results?: unknown[] };
                    filteredCount = (orig.results?.length ?? 0) - (filt.results?.length ?? 0);
                } catch { /* non-JSON → 0 */ }

                audit?.write({
                    ts: new Date().toISOString(), userId: p.id, role: p.role,
                    department: p.department, tool: short,
                    decision: 'allowed', durationMs: Date.now() - start,
                    extra: filteredCount > 0 ? { filteredCount } : undefined,
                });

                return filtered;
            }

            // read_note permitido
            audit?.write({
                ts: new Date().toISOString(), userId: p.id, role: p.role,
                department: p.department, tool: short,
                decision: 'allowed', durationMs: Date.now() - start,
                extra: typeof a['path_or_title'] === 'string'
                    ? { vaultPath: a['path_or_title'] }
                    : undefined,
            });

            return result;
        },
    };
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
    // For the 'runs' entry, if ORCHESTRATOR_CONFIG is not set, default to BK_HOME seed config
    const mcpConfigs = config.agents.map(entry => {
        const env = { ...(entry.env ?? {}) };
        if (entry.name === 'runs' && !env['ORCHESTRATOR_CONFIG']) {
            env['ORCHESTRATOR_CONFIG'] = bkPaths.orchestratorMcpConfig();
        }
        return {
            name:    entry.name,
            command: entry.command,
            args:    resolveAgentArgs(entry, configDir),
            env,
        };
    });

    const mcp = new MCPClientManager(mcpConfigs);
    await mcp.initialize();

    const connectedServers = mcp.getServerInfo();
    const rawMcpTools = mcp.getTools();

    // ── Policy engine (Capa 2 + 3) ───────────────────────────────────────────
    const policyEngine = config.access_control
        ? new PolicyEngine(config.access_control)
        : null;

    // ── Vault filter (Capa 4) ─────────────────────────────────────────────────
    const vaultFilter = config.access_control?.vault_visibility
        ? new VaultFilter(config.access_control.vault_visibility)
        : null;

    // ── Audit logger (Capa 5) ─────────────────────────────────────────────────
    const auditCfg    = config.access_control?.audit;
    const auditLogger = auditCfg?.enabled
        ? new AuditLogger(buildAuditPath(auditCfg.path))
        : null;

    const mcpTools = rawMcpTools
        .map(t => policyEngine ? guardTool(t, policyEngine, auditLogger) : t)
        .map(t => vaultFilter  ? applyVaultFilter(t, vaultFilter, auditLogger) : t);

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

    // ── MemorySystem 3-tier ───────────────────────────────────────────────────
    const memory = createMemorySystem({
        episodic:   { provider: 'json', path: bkPaths.memoryEpisodic() },
        semantic:   { provider: 'json', path: bkPaths.memorySemantic() },
        procedural: { provider: 'json', path: bkPaths.memoryProcedural() },
        retention:  { maxEpisodes: 500 },
    });
    const memoryTools = memory.getTools();

    // ── Registries ────────────────────────────────────────────────────────────
    const tools = new ToolRegistry();
    for (const t of mcpTools) tools.register(t);
    for (const t of memoryTools) tools.register(t);

    // allowedTools: MCP tools + memory tools (excludes ask_agent)
    const allToolNames = [...mcpToolNames, ...memoryTools.map(t => t.name)];

    const agents = new AgentRegistry();
    agents.register(buildDirectorProfile(systemPrompt, allToolNames));

    const providers = new ProviderRegistry();
    providers.register(providerName, new DirectorProvider({
        apiKey:   providerCfg.api_key,
        model:    providerCfg.model,
        baseUrl:  providerCfg.base_url,
    }));

    // ── Transport ─────────────────────────────────────────────────────────────
    // Si hay un onEvent en el requestContext (WS per-request), tiene prioridad
    // sobre el callback global (MCP server / REPL).
    const transport = new CallbackTransport((evt: AgentEvent) => {
        const ctx = requestContext.getStore();
        if (ctx?.onEvent) { ctx.onEvent(evt); } else { onEvent?.(evt); }
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
        memorySystem:    memory,
    });

    return { engine, mcp, provider: providerName, model: providerCfg.model, policyEngine, vaultFilter, auditLogger };
}

/** Resolves the director.yaml path: explicit arg > env var > default location. */
export function resolveConfigPath(arg?: string): string {
    if (arg)                            return path.resolve(arg);
    if (process.env.DIRECTOR_CONFIG)   return path.resolve(process.env.DIRECTOR_CONFIG);
    return path.resolve(import.meta.dirname, '..', 'director.yaml');
}
