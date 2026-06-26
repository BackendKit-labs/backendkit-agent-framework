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
import type { Principal } from './auth/types.js';

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

// ── Infra compartida (cara de levantar, sin estado por-usuario) ───────────────
//
// MCP (procesos hijos), providers, policy/vault/audit y el system prompt se
// construyen UNA vez y se comparten entre todas las sesiones. Lo que es por
// usuario (historial, memoria, ToolRegistry) se crea en createSessionEngine.

export interface SharedInfra {
    mcp:           MCPClientManager;
    rawMcpTools:   ToolDefinition[];
    policyEngine:  PolicyEngine | null;
    vaultFilter:   VaultFilter | null;
    auditLogger:   AuditLogger | null;
    systemPrompt:  string;
    providers:     ProviderRegistry;
    providerName:  string;
    providerModel: string;
    maxIterations: number;
    /** Soul + connected-server topology used to rebuild systemPrompt after restart. */
    soul:          string;
    configDir:     string;
}

export async function buildSharedInfra(
    config:    DirectorConfig,
    configDir: string,
): Promise<SharedInfra> {

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

    const providers = new ProviderRegistry();
    providers.register(providerName, new DirectorProvider({
        apiKey:   providerCfg.api_key,
        model:    providerCfg.model,
        baseUrl:  providerCfg.base_url,
    }));

    return {
        mcp, rawMcpTools, policyEngine, vaultFilter, auditLogger, systemPrompt,
        providers, providerName, providerModel: providerCfg.model,
        maxIterations: config.director.max_iterations,
        soul, configDir,
    };
}

// ── MemorySystem por usuario ──────────────────────────────────────────────────
//
// Dev/REPL (admin implícito, id 'system') usa las rutas legacy compartidas.
// Los usuarios reales tienen memoria aislada en memory/users/<id>/.

function buildSessionMemory(principal: Principal): ReturnType<typeof createMemorySystem> {
    if (principal.id === 'system') {
        return createMemorySystem({
            episodic:   { provider: 'json', path: bkPaths.memoryEpisodic() },
            semantic:   { provider: 'json', path: bkPaths.memorySemantic() },
            procedural: { provider: 'json', path: bkPaths.memoryProcedural() },
            retention:  { maxEpisodes: 500 },
        });
    }
    const safeId = principal.id.replace(/[^a-zA-Z0-9._-]/g, '_');
    const base   = path.join(bkPaths.memoryDir(), 'users', safeId);
    return createMemorySystem({
        episodic:   { provider: 'json', path: path.join(base, 'episodic.json') },
        semantic:   { provider: 'json', path: path.join(base, 'semantic.json') },
        procedural: { provider: 'json', path: path.join(base, 'procedural.json') },
        retention:  { maxEpisodes: 500 },
    });
}

// ── Engine por sesión ─────────────────────────────────────────────────────────
//
// Una instancia de engine por usuario: historial, memoria y ToolRegistry propios
// (un ToolRegistry compartido se corrompería — cada engine re-registra las tools
// MCP). El mcpManager/providers se comparten vía SharedInfra. Los guards leen el
// principal del requestContext, así que funcionan sin recablearse por sesión.

export function createSessionEngine(
    shared:    SharedInfra,
    principal: Principal,
    onEvent?:  (evt: AgentEvent) => void,
): AgentEngine {
    const memory      = buildSessionMemory(principal);
    const memoryTools = memory.getTools();

    const mcpTools = shared.rawMcpTools
        .map(t => shared.policyEngine ? guardTool(t, shared.policyEngine, shared.auditLogger) : t)
        .map(t => shared.vaultFilter  ? applyVaultFilter(t, shared.vaultFilter, shared.auditLogger) : t);

    const tools = new ToolRegistry();
    for (const t of mcpTools)    tools.register(t);
    for (const t of memoryTools) tools.register(t);

    const allToolNames = [...mcpTools.map(t => t.name), ...memoryTools.map(t => t.name)];

    const agents = new AgentRegistry();
    agents.register(buildDirectorProfile(shared.systemPrompt, allToolNames));

    // Si hay un onEvent en el requestContext (WS/MCP per-request), tiene prioridad
    // sobre el callback global (REPL).
    const transport = new CallbackTransport((evt: AgentEvent) => {
        const ctx = requestContext.getStore();
        if (ctx?.onEvent) { ctx.onEvent(evt); } else { onEvent?.(evt); }
    });

    return new AgentEngine({
        model:           { provider: shared.providerName, id: shared.providerModel },
        agents,
        tools,
        providers:       shared.providers,
        defaultProvider: shared.providerName,
        defaultAgentId:  'director',
        transport,
        maxIterations:   shared.maxIterations,
        iterationMode:   'auto',
        memorySystem:    memory,
    });
}

// ── Manager de engines por usuario (caché con eviction LRU) ───────────────────
//
// Mantiene un engine por user.id para que el historial/memoria no se crucen entre
// usuarios. Las distintas conexiones del MISMO usuario comparten su engine.

export class SessionEngineManager {
    private readonly engines = new Map<string, { engine: AgentEngine; principal: Principal; lastUsed: number }>();

    constructor(
        private readonly shared:      SharedInfra,
        private readonly maxSessions: number = 50,
    ) {}

    /** Engine del principal (lo crea perezosamente la primera vez). */
    get(principal: Principal): AgentEngine {
        const key = principal.id || 'anon';
        let entry = this.engines.get(key);
        if (!entry) {
            entry = { engine: createSessionEngine(this.shared, principal), principal, lastUsed: Date.now() };
            this.engines.set(key, entry);
            this.evict();
        }
        entry.lastUsed = Date.now();
        return entry.engine;
    }

    clearHistory(principal: Principal): void {
        this.engines.get(principal.id || 'anon')?.engine.clearHistory();
    }

    /**
     * Recarga rawMcpTools desde el MCPClientManager y reconstruye todos los engines
     * activos. Llamar después de un restartAgent() para que las tools nuevas sean visibles.
     * Los historiales de conversación se preservan (se crea un nuevo engine por sesión).
     */
    refreshTools(): void {
        this.shared.rawMcpTools = this.shared.mcp.getTools();

        // Rebuild system prompt with the current connected topology
        const topology = this.shared.mcp.getServerInfo().map(s => ({
            name:      s.name,
            toolCount: s.toolCount,
            tools:     this.shared.mcp.getServerTools(s.name).map(t => {
                const parts = t.name.split('__');
                return parts[parts.length - 1] ?? t.name;
            }),
        }));
        this.shared.systemPrompt = buildSystemPrompt(this.shared.soul, topology);

        // Rebuild all active session engines (history is not preserved — intentional on restart)
        for (const [key, entry] of this.engines) {
            const newEngine = createSessionEngine(this.shared, entry.principal);
            this.engines.set(key, { engine: newEngine, principal: entry.principal, lastUsed: entry.lastUsed });
        }
    }

    get mcp(): MCPClientManager { return this.shared.mcp; }
    get policyEngine(): PolicyEngine | null { return this.shared.policyEngine; }

    /** Desaloja el engine menos usado recientemente cuando se supera el cap. */
    private evict(): void {
        if (this.engines.size <= this.maxSessions) return;
        let oldestKey: string | undefined;
        let oldest = Infinity;
        for (const [k, v] of this.engines) {
            if (v.lastUsed < oldest) { oldest = v.lastUsed; oldestKey = k; }
        }
        if (oldestKey) {
            this.engines.get(oldestKey)?.engine.abort();
            this.engines.delete(oldestKey);
        }
    }
}

// ── Backward-compat: engine único (REPL / dev) ────────────────────────────────

export interface DirectorRuntime {
    engine:       AgentEngine;
    mcp:          MCPClientManager;
    /** Registered provider name (e.g. 'deepseek') */
    provider:     string;
    model:        string;
    policyEngine: PolicyEngine | null;
    vaultFilter:  VaultFilter | null;
    auditLogger:  AuditLogger | null;
    /**
     * Restart one agent (or all failed ones if name omitted).
     * Updates rawMcpTools + rebuilds the REPL engine with fresh tools.
     * Returns the names of agents now connected.
     */
    restartAgent: (name?: string) => Promise<{ connected: string[]; engine: AgentEngine }>;
}

export async function buildDirectorEngine(
    config:    DirectorConfig,
    configDir: string,
    onEvent?:  (evt: AgentEvent) => void,
): Promise<DirectorRuntime> {
    const shared  = await buildSharedInfra(config, configDir);

    // Mutable ref so restartAgent() can swap the engine in the closure.
    let engine = createSessionEngine(shared, ADMIN_PRINCIPAL, onEvent);

    const restartAgent = async (name?: string): Promise<{ connected: string[]; engine: AgentEngine }> => {
        const connected = await shared.mcp.restartAgent(name);
        shared.rawMcpTools = shared.mcp.getTools();

        const topology = shared.mcp.getServerInfo().map(s => ({
            name:      s.name,
            toolCount: s.toolCount,
            tools:     shared.mcp.getServerTools(s.name).map(t => {
                const parts = t.name.split('__');
                return parts[parts.length - 1] ?? t.name;
            }),
        }));
        shared.systemPrompt = buildSystemPrompt(shared.soul, topology);

        engine = createSessionEngine(shared, ADMIN_PRINCIPAL, onEvent);
        return { connected, engine };
    };

    return {
        engine,
        mcp:          shared.mcp,
        provider:     shared.providerName,
        model:        shared.providerModel,
        policyEngine: shared.policyEngine,
        vaultFilter:  shared.vaultFilter,
        auditLogger:  shared.auditLogger,
        restartAgent,
    };
}

/** Resolves the director.yaml path: explicit arg > env var > default location. */
export function resolveConfigPath(arg?: string): string {
    if (arg)                            return path.resolve(arg);
    if (process.env.DIRECTOR_CONFIG)   return path.resolve(process.env.DIRECTOR_CONFIG);
    return path.resolve(import.meta.dirname, '..', 'director.yaml');
}
