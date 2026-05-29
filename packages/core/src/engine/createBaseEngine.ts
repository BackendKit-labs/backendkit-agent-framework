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

    return new AgentEngine({
        model: { provider: opts.defaultProvider, id: opts.defaultProvider },
        agents,
        tools,
        providers,
        defaultProvider: opts.defaultProvider,
        transport: opts.transport ?? new StdoutTransport(),
        defaultAgentId,
        workingDir: opts.workingDir,
        maxIterations: opts.maxIterations ?? 100,
        maxParallelAgents: opts.maxParallelAgents ?? 6,
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
    });
}
