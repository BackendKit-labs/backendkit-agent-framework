import { AgentEngine } from './AgentEngine';
import { AgentRegistry } from './AgentRegistry';
import { ToolRegistry } from './ToolRegistry';
import { ProviderRegistry } from './ProviderRegistry';
import { StdoutTransport } from '../transport/StdoutTransport';
import type {
    AgentProfile,
    LLMProvider,
    ToolDefinition,
    SessionMemoryData,
    ProjectStoreData,
    Skill,
} from '../types';
import type { Transport } from '../transport/Transport';
import type { Orchestrator } from '../orchestration/orchestrator';
import type { QAService } from '../qa/qa-service';
import { MCPClientManager } from '../mcp/MCPClientManager';
import type { MCPServerConfig } from '../mcp/types';
import { ObservabilityManager } from '../observability/ObservabilityManager';
import type { ObservabilityConfig } from '../observability/types';
import type { MemorySystem } from '../agent-memory/MemorySystem';
import { discoverAgents } from '../agent-discovery/discoverAgents';
import type { AgentDiscoveryConfig } from '../agent-discovery/types';

// ── Options ───────────────────────────────────────────────────────────────────

export interface BaseEngineOptions {
    /**
     * Pre-instantiated LLM providers keyed by provider ID.
     * The caller is responsible for creating the provider instances
     * (e.g. new AnthropicProvider(...), new OpenAICompatibleProvider(...)).
     */
    providers: Record<string, LLMProvider>;

    /** ID of the provider to use by default. Must exist in providers. */
    defaultProvider: string;

    /** Agents to register. Empty by default — caller adds their own agents. */
    agents?: AgentProfile[];

    /** Tools to make available to agents. Empty by default. */
    tools?: ToolDefinition[];

    /**
     * Agent ID that receives the first message and orchestrates the session.
     * Defaults to the first agent's ID, or 'general' if no agents are provided.
     */
    defaultAgent?: string;

    /** How events (tokens, tool calls, errors) are delivered. Defaults to StdoutTransport. */
    transport?: Transport;

    /** Max LLM iterations per run() call. Default: 100. */
    maxIterations?: number;

    /** Max parallel agent delegations via ask_agent. Default: 6. */
    maxParallelAgents?: number;

    /**
     * Maximum number of messages to keep in conversation history (sliding window).
     * Oldest messages are dropped at user-turn boundaries to avoid orphaning tool
     * call / result pairs. A 'system' warn event is emitted when trimming occurs.
     * Default: unlimited. Recommended: 100 for interactive agents, 40–60 for
     * long-running autonomous agents.
     */
    maxContextMessages?: number;

    /** Absolute path used as the working directory for tool calls. */
    workingDir?: string;

    /** Injected into every agent system prompt (stack, AGENT.md, session, etc.). */
    projectContext?: string;

    /** Pre-loaded skills. Injected per-run based on trigger + stack matching. */
    skills?: Skill[];

    /** Stack identifiers for skill language gating (e.g. ['node', 'typescript']). */
    detectedStack?: string[];

    /**
     * Called once on first run() to load additional skills from disk.
     * Results are merged with skills[].
     */
    loadSkills?: () => Promise<Skill[]>;

    /** Custom session memory. Defaults to in-memory SessionMemory. */
    sessionMemory?: SessionMemoryData;

    /** Persistent project store (context, learnings, audits). Optional. */
    store?: ProjectStoreData;

    /** Session ID for tracking and correlation. */
    sessionId?: string;

    /**
     * Orchestrator for pre-LLM task classification:
     * intent detection → domain detection → risk scoring → policy engine → FSM gates.
     * When provided, General receives domain/risk context before each run.
     * Use createOrchestratedCodingEngine() or pass directly for full control.
     */
    orchestrator?: Orchestrator;

    /**
     * QA service for automatic code review after high-risk responses.
     * Requires orchestrator to be set. When active, the qa-engineer agent
     * is automatically triggered for responses with substantial code.
     */
    qaService?: QAService;

    /** Disable automatic QA reviews even when qaService is configured. */
    noQA?: boolean;

    /** Called when QA generates an inline review. */
    onQAReview?: (review: string) => void;

    /**
     * Observability: tracing, metrics, and cost/budget tracking.
     * Wraps the transport transparently — no changes to existing code needed.
     *
     * @example
     * observability: {
     *   tracing: { exporter: 'console' },
     *   costTracker: {
     *     ...MODEL_PRICING['claude-sonnet-4-6'],
     *     budget: { perRun: 0.50, perDay: 10.00 },
     *     onBudgetExceeded: (u) => { engine.abort(); console.warn('Budget exceeded', u); },
     *   },
     *   metrics: { onSnapshot: (s) => console.log('runs:', s.runs.total) },
     * }
     */
    observability?: ObservabilityConfig;

    /**
     * Agent discovery — load agents from local directories and/or a remote registry.
     * Discovered agents are merged with statically provided agents[] on the first run().
     *
     * Local directories scanned:
     *   ~/.{appName}/agents/               ← global (shared across projects)
     *   {workingDir}/.{appName}/agents/    ← project-local (git-tracked)
     *
     * @example
     * agentDiscovery: {
     *   appName: 'my-app',
     *   remote: 'https://registry.backendkit.dev/agents',
     *   install: ['@bk/agent-devops-aws', '@bk/agent-mobile-android'],
     * }
     */
    agentDiscovery?: AgentDiscoveryConfig;

    /**
     * Number of recent messages from the orchestrator's conversation to inject
     * into each sub-agent call. Gives specialists visibility into previously
     * gathered data (file reads, command outputs) without requiring the
     * orchestrator to copy it manually into the ask_agent context field.
     * Sliced at a user-turn boundary. Default: 0.
     */
    subAgentContextMessages?: number;

    /**
     * Advanced three-tier memory system (episodic / semantic / procedural).
     * When provided, memory tools are auto-registered and the context block
     * is injected into every agent system prompt.
     *
     * @example
     * memorySystem: createMemorySystem({
     *   episodic:   { provider: 'json', path: '~/.bk/episodes.json' },
     *   semantic:   { provider: 'json', path: '~/.bk/knowledge.json', embedFn: myEmbedder },
     *   retention:  { maxEpisodes: 1000 },
     * })
     */
    memorySystem?: MemorySystem;

    /**
     * External MCP servers to connect to.
     * Tools are discovered on the first run() call (lazy connection) and
     * made available to all agents in the session.
     *
     * @example
     * mcpServers: [
     *   { name: 'github',   command: 'npx', args: ['@modelcontextprotocol/server-github'],   env: { GITHUB_TOKEN } },
     *   { name: 'postgres', command: 'npx', args: ['@modelcontextprotocol/server-postgres'],  env: { DATABASE_URL } },
     * ]
     */
    mcpServers?: MCPServerConfig[];

    /**
     * Path to an append-only NDJSON file for automatic tool call audit records.
     * Each tool execution appends one JSON line: ts, session, agent, tool, input (truncated), success, durationMs.
     * The directory is created automatically if it doesn't exist.
     * When absent, no audit file is written.
     */
    auditLog?: string;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Minimal engine factory with no domain-specific assumptions.
 *
 * Callers provide:
 * - Pre-instantiated LLM providers
 * - The agents they want to register
 * - The tools they want available
 *
 * Use this as the foundation for any agent type: coding, autonomous, support, etc.
 * For a fully configured coding agent, use createCodingEngine() from @bk/agent-coding.
 */
export function createBaseEngine(opts: BaseEngineOptions): AgentEngine {
    const agents = new AgentRegistry();
    for (const agent of opts.agents ?? []) agents.upsert(agent);

    const tools = new ToolRegistry();
    for (const tool of opts.tools ?? []) tools.register(tool);
    if (opts.memorySystem) {
        for (const tool of opts.memorySystem.getTools()) tools.register(tool);
    }

    const providers = new ProviderRegistry();
    for (const [id, provider] of Object.entries(opts.providers)) {
        providers.register(id, provider);
    }

    if (!providers.has(opts.defaultProvider)) {
        throw new Error(
            `defaultProvider "${opts.defaultProvider}" is not in providers. ` +
            `Available: ${Object.keys(opts.providers).join(', ')}`
        );
    }

    const defaultAgentId = opts.defaultAgent
        ?? opts.agents?.[0]?.id
        ?? 'general';

    // Wrap transport with observability if configured
    const obsManager = opts.observability ? new ObservabilityManager(opts.observability) : undefined;
    const baseTransport = opts.transport ?? new StdoutTransport();
    const transport = obsManager ? obsManager.wrapTransport(baseTransport) : baseTransport;

    return new AgentEngine({
        model: { provider: opts.defaultProvider, id: opts.defaultProvider },
        agents,
        tools,
        providers,
        defaultProvider: opts.defaultProvider,
        transport,
        defaultAgentId,
        workingDir: opts.workingDir,
        maxIterations: opts.maxIterations ?? 100,
        maxParallelAgents: opts.maxParallelAgents ?? 6,
        ...(opts.maxContextMessages ? { maxContextMessages: opts.maxContextMessages } : {}),
        ...(opts.subAgentContextMessages ? { subAgentContextMessages: opts.subAgentContextMessages } : {}),
        projectContext: opts.projectContext,
        skills: opts.skills,
        detectedStack: opts.detectedStack,
        loadSkills: opts.loadSkills,
        ...(opts.sessionMemory ? { sessionMemory: opts.sessionMemory } : {}),
        ...(opts.store ? { store: opts.store } : {}),
        ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
        ...(opts.orchestrator ? { orchestrator: opts.orchestrator } : {}),
        ...(opts.qaService ? { qaService: opts.qaService } : {}),
        ...(opts.noQA !== undefined ? { noQA: opts.noQA } : {}),
        ...(opts.onQAReview ? { onQAReview: opts.onQAReview } : {}),
        ...(opts.mcpServers?.length
            ? { mcpManager: new MCPClientManager(opts.mcpServers) }
            : {}),
        ...(obsManager ? { observabilityManager: obsManager } : {}),
        ...(opts.memorySystem ? { memorySystem: opts.memorySystem } : {}),
        ...(opts.auditLog ? { auditLog: opts.auditLog } : {}),
        ...(opts.agentDiscovery
            ? {
                loadAgents: () => discoverAgents({
                    ...opts.agentDiscovery!,
                    workingDir: opts.agentDiscovery!.workingDir ?? opts.workingDir,
                }),
            }
            : {}),
    });
}
