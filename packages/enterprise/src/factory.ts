import * as path from 'path';
import * as os from 'os';
import {
    AgentEngine,
    ProviderRegistry,
    createBaseEngine,
    createMemorySystem,
    defineTool,
    z,
} from '@backendkit-labs/agent-core';
import type { Transport, AgentProfile, ToolDefinition } from '@backendkit-labs/agent-core';
import { ObsidianRAGProvider } from './rag/ObsidianRAGProvider';
import type { Embedder } from './rag/ObsidianRAGProvider';
import { VaultWriter } from './rag/VaultWriter';
import { SimpleEmbedder } from './rag/SimpleEmbedder';
import {
    ALL_ENTERPRISE_PROFILES,
    ENTERPRISE_TOOLS,
    VAULT_FOLDERS,
} from './profiles';
import { createN8nTriggerTool } from './integrations';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EnterpriseSetupOptions {
    /** Absolute path to the shared Obsidian vault. */
    vaultPath: string;
    /**
     * Top-level folders of the vault that the general agent (the global search) never sees. Default: the folders of HR and Finance, whose
     * agents use a local provider: what the general agent retrieves goes to the default provider, which may be remote. Pass [] to let
     * it search the whole vault, as before.
     */
    globalExcludeFolders?: string[];
    /** Directory where RAG index files are stored. Default: ~/.bk-agent/rag/enterprise/ */
    indexDir?: string;
    /** Embedder to use. Default: SimpleEmbedder (no Ollama required). */
    embedder?: Embedder;
    /** Pre-configured ProviderRegistry with at least one LLM provider. */
    providers: ProviderRegistry;
    /** Gives each agent its digital identity (SPEC-0044). Required by default: with none, every tool call is denied. See `selfAssertedIdentities()` of agent-core. */
    agentIdentity?: import('@backendkit-labs/agent-core').AgentIdentityProvider;
    /** Whom the agents act for: `{ userId }` is required by default, together with an identity. */
    identity?: import('@backendkit-labs/agent-core').Identity;
    /** `false` lets agents act without identity, for tests only. */
    requireAgentIdentity?: boolean;
    /** Default provider ID to use when no per-agent override is set. */
    defaultProvider: string;
    /** Directory for per-session memory files. Default: ~/.bk-agent/sessions/ */
    sessionsDir?: string;
    /** Additional AgentProfiles to register alongside the 6 enterprise defaults. */
    extraProfiles?: AgentProfile[];
    /** Max iterations per engine run. Default: 20. */
    maxIterations?: number;
    /**
     * n8n webhook URL. When provided, registers the `n8n_trigger` tool so agents
     * with it in their allowedTools (e.g. the General agent) can fire n8n workflows.
     * Falls back to N8N_WEBHOOK_URL env var if omitted.
     */
    n8nWebhookUrl?: string;
    /**
     * Guardrails applied to every session (e.g. `[secretLeakGuardrail(), piiGuardrail()]` from
     * @backendkit-labs/agent-core). None by default. Needs agent-core >= 0.28.
     */
    guardrails?: import('@backendkit-labs/agent-core').Guardrail[];
    /** `after` (default) or `buffer`; see BaseEngineOptions.guardrailOutputMode. */
    guardrailOutputMode?: 'after' | 'buffer';
    /** Default time limit for one tool call in ms. Default: none. Needs agent-core >= 0.29. */
    toolTimeoutMs?: number;
    /** Background jobs (see BaseEngineOptions.jobs). Add job_output/job_list/job_kill to the agents' allowedTools. Needs agent-core >= 0.29. */
    jobs?: boolean | import('@backendkit-labs/agent-core').JobRegistryOptions;
    /** Resolves `AgentProfile.secrets` references whose env var is unset. Needs agent-core >= 0.29. */
    secretResolver?: (name: string, agentId: string) => string | undefined | Promise<string | undefined>;
    /** Confined execution (see BaseEngineOptions.sandbox), e.g. from `@backendkit-labs/agent-sandbox`. Needs agent-core >= 0.30. */
    sandbox?: import('@backendkit-labs/agent-core').SandboxRunner;
    /** Token-aware context compaction for every session. Needs agent-core >= 0.28. */
    context?: import('@backendkit-labs/agent-core').ContextOptions;
}

export interface EnterpriseSetup {
    /** Call once at startup to index all vault folders. */
    indexAll(opts?: { verbose?: boolean }): Promise<void>;
    /** EngineFactory compatible with AgentServer from @backendkit-labs/agent-web. */
    engineFactory: (sessionId: string, transport: Transport) => AgentEngine;
}

// ── Department RAG config ─────────────────────────────────────────────────────

/** Where each department's agent writes what it learns: its own folder. Any other agent writes to `agentes/`. */
const WRITE_FOLDERS: Record<string, string> = {
    hr: VAULT_FOLDERS.HR,
    finance: VAULT_FOLDERS.FINANCE,
    sales: VAULT_FOLDERS.SALES,
    support: VAULT_FOLDERS.SUPPORT,
    ops: VAULT_FOLDERS.OPS,
    general: VAULT_FOLDERS.GENERAL,
};

const DEPT_CONFIGS: Array<{ toolName: string; folders: string[] }> = [
    { toolName: ENTERPRISE_TOOLS.SEARCH_SUPPORT,  folders: [VAULT_FOLDERS.SUPPORT,  VAULT_FOLDERS.GENERAL, VAULT_FOLDERS.POLICIES] },
    { toolName: ENTERPRISE_TOOLS.SEARCH_HR,       folders: [VAULT_FOLDERS.HR,       VAULT_FOLDERS.GENERAL, VAULT_FOLDERS.POLICIES] },
    { toolName: ENTERPRISE_TOOLS.SEARCH_SALES,    folders: [VAULT_FOLDERS.SALES,    VAULT_FOLDERS.GENERAL, VAULT_FOLDERS.POLICIES] },
    { toolName: ENTERPRISE_TOOLS.SEARCH_FINANCE,  folders: [VAULT_FOLDERS.FINANCE,  VAULT_FOLDERS.GENERAL, VAULT_FOLDERS.POLICIES] },
    { toolName: ENTERPRISE_TOOLS.SEARCH_OPS,      folders: [VAULT_FOLDERS.OPS,      VAULT_FOLDERS.GENERAL, VAULT_FOLDERS.POLICIES] },
];

// ── Factory ────────────────────────────────────────────────────────────────────

/**
 * Creates a fully-wired enterprise setup with:
 * - One RAG instance per department (scoped to its vault folders)
 * - One global RAG for the General agent
 * - VaultWriter shared across all agents
 * - EngineFactory that creates a new AgentEngine per WebSocket session
 *
 * Usage:
 * ```ts
 * const enterprise = createEnterpriseSetup({ vaultPath, providers, defaultProvider });
 * await enterprise.indexAll();
 *
 * const server = new AgentServer({ port: 3000, engineFactory: enterprise.engineFactory, cors: '*' });
 * await server.start();
 * ```
 */
export function createEnterpriseSetup(opts: EnterpriseSetupOptions): EnterpriseSetup {
    const embedder  = opts.embedder ?? new SimpleEmbedder();
    const indexDir  = opts.indexDir  ?? path.join(os.homedir(), '.bk-agent', 'rag', 'enterprise');
    const sessionsDir = opts.sessionsDir ?? path.join(os.homedir(), '.bk-agent', 'sessions');

    // ── Shared RAG instances (one per department + one global) ───────────────

    // The general agent answers with the default provider, which may be remote: what it can search is what that provider may see.
    // The folders of HR and Finance (whose agents default to a local provider) are left out unless the operator says otherwise.
    const globalRAG = new ObsidianRAGProvider({
        vaultPath:  opts.vaultPath,
        indexPath:  path.join(indexDir, 'global.json'),
        excludeFolders: opts.globalExcludeFolders ?? [VAULT_FOLDERS.HR, VAULT_FOLDERS.FINANCE],
        embedder,
        topK: 5,
        minScore: 0.1,
    });

    const deptRAGs = new Map<string, ObsidianRAGProvider>(
        DEPT_CONFIGS.map(({ toolName, folders }) => [
            toolName,
            new ObsidianRAGProvider({
                vaultPath: opts.vaultPath,
                folders,
                indexPath: path.join(indexDir, `${folders[0]}.json`),
                embedder,
                topK: 5,
                minScore: 0.1,
            }),
        ])
    );

    // ── Shared VaultWriter ───────────────────────────────────────────────────

    // One writer per department, each in its own folder: what HR writes stays where HR's search finds it, and not in a folder every
    // agent searches. The note says which agent wrote it (the author), and the search tells the reader.
    const writers = new Map<string, VaultWriter>(
        Object.entries(WRITE_FOLDERS).map(([agentId, folder]) => [agentId, new VaultWriter({ vaultPath: opts.vaultPath, agentFolder: folder })]),
    );
    const fallbackWriter = new VaultWriter({ vaultPath: opts.vaultPath, agentFolder: VAULT_FOLDERS.AGENTS });
    const writerFor = (agentId: string): VaultWriter => writers.get(agentId) ?? fallbackWriter;

    // ── Index all ────────────────────────────────────────────────────────────

    async function indexAll(indexOpts: { verbose?: boolean } = {}): Promise<void> {
        const all = [globalRAG, ...deptRAGs.values()];
        await Promise.all(all.map(rag => rag.index(indexOpts)));
    }

    // ── Engine factory ────────────────────────────────────────────────────────

    function engineFactory(sessionId: string, transport: Transport): AgentEngine {
        const tools: ToolDefinition[] = [globalRAG.createTool()];

        // Department search tools
        for (const [toolName, rag] of deptRAGs) {
            const deptRag = rag;
            tools.push(
                defineTool({
                    name: toolName,
                    description: `Search the ${toolName.replace('search_', '').replace('_kb', '')} department knowledge base.`,
                    input: z.object({
                        query: z.string().describe('What to search for'),
                    }),
                    execute: async ({ query }) => deptRag.search(query),
                })
            );
        }

        // Write to vault
        tools.push(fallbackWriter.createToolFor(ctx => ctx.agentId ?? 'general', writerFor));

        // n8n integration (opt-in — only when a webhook URL is configured)
        const n8nUrl = opts.n8nWebhookUrl ?? process.env.N8N_WEBHOOK_URL;
        if (n8nUrl) {
            tools.push(createN8nTriggerTool({ webhookUrl: n8nUrl }));
        }

        // Agents
        const agents = [...ALL_ENTERPRISE_PROFILES, ...(opts.extraProfiles ?? [])];

        const providers = opts.providers.getAll();

        // Per-session memory
        const memory = createMemorySystem({
            episodic:   { provider: 'json', path: path.join(sessionsDir, sessionId, 'ep.json') },
            semantic:   { provider: 'json', path: path.join(sessionsDir, sessionId, 'sem.json') },
            procedural: { provider: 'json', path: path.join(sessionsDir, sessionId, 'proc.json') },
            retention:  { maxEpisodes: 100 },
        });

        const engine = createBaseEngine({
            agents,
            tools,
            providers,
            defaultProvider: opts.defaultProvider,
            defaultAgent:    'general',
            transport,
            maxIterations:   opts.maxIterations ?? 20,
            memorySystem:    memory,
            sessionId,
            ...(opts.guardrails?.length ? { guardrails: opts.guardrails } : {}),
            ...(opts.guardrailOutputMode ? { guardrailOutputMode: opts.guardrailOutputMode } : {}),
            ...(opts.toolTimeoutMs ? { toolTimeoutMs: opts.toolTimeoutMs } : {}),
            ...(opts.jobs ? { jobs: opts.jobs } : {}),
            ...(opts.secretResolver ? { secretResolver: opts.secretResolver } : {}),
            ...(opts.sandbox ? { sandbox: opts.sandbox } : {}),
            ...(opts.context ? { context: opts.context } : {}),
            ...(opts.agentIdentity ? { agentIdentity: opts.agentIdentity } : {}),
            ...(opts.identity ? { identity: opts.identity } : {}),
            ...(opts.requireAgentIdentity !== undefined ? { requireAgentIdentity: opts.requireAgentIdentity } : {}),
        });
        // createBaseEngine defaults to 'interactive' — enterprise sessions run unattended per WS turn.
        engine.setIterationMode('auto');
        return engine;
    }

    return { indexAll, engineFactory };
}
