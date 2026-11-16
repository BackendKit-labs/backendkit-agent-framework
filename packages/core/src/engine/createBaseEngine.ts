import { AgentEngine } from './AgentEngine';
import { AgentRegistry } from './AgentRegistry';
import { ToolRegistry } from './ToolRegistry';
import { ProviderRegistry } from './ProviderRegistry';
import { StdoutTransport } from '../transport/StdoutTransport';
import { createJobRegistry } from '../jobs/JobRegistry';
import type { JobRegistryOptions } from '../jobs/JobRegistry';
import { JOB_TOOLS } from '../jobs/tools';
import type { SandboxRunner } from '../sandbox/types';
import type {
    AgentProfile,
    LLMProvider,
    ToolDefinition,
    ToolApprovalDecision,
    SessionMemoryData,
    Skill,
    EngineOptions,
} from '../types';
import type { Transport } from '../transport/Transport';
import { MCPClientManager } from '../mcp/MCPClientManager';
import type { MCPServerConfig } from '../mcp/types';
import { ObservabilityManager } from '../observability/ObservabilityManager';
import type { ObservabilityConfig } from '../observability/types';
import type { MemorySystem } from '../agent-memory/MemorySystem';
import { instructionSourceHooks, listAgentSources, listSkillSources } from '../sources';
import type { AgentSource, SkillSource, InstructionSource } from '../sources';
import type { IterationMode, IterationStats } from './IterationManager';
import type { ContextOptions } from './ContextManager';
import type { ApprovalStore, Approver, AuditSink, Identity, ToolPolicy } from '../governance/types';
import { defaultToolPolicy } from '../governance/policy';
import type { Learning } from '../learning/types';
import type { EngineHooks } from '../governance/hooks';
import type { Guardrail } from '../guardrails/types';

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

    /**
     * Default time limit for one tool call, in ms (a tool's own `timeoutMs` wins). On expiry the call's
     * `ctx.signal` is aborted and the model receives `Error: TOOL_TIMEOUT …`; a late result is discarded.
     * Time waiting for approval does not count. Default: no limit.
     */
    toolTimeoutMs?: number;

    /**
     * Enables background jobs: registers `job_output`, `job_list` and `job_kill` (add them to `allowedTools`
     * of the agents that use them) and gives tools `ctx.jobs`. `true` uses the defaults (8 live jobs per agent,
     * 64 KB of output each, finished jobs kept 10 min). Each agent only sees its own jobs.
     */
    jobs?: boolean | JobRegistryOptions;

    /**
     * Confined execution, from `@backendkit-labs/agent-sandbox` (`createSandboxService`) or any `SandboxRunner`.
     * Tools get `ctx.sandbox`; in read-only the policy's write tools are refused; the policy decides which
     * tools ask for approval (with no `onToolApproval` configured, those are refused). Read the running
     * service back with `engine.sandbox`.
     */
    sandbox?: SandboxRunner;

    /** Resolves `AgentProfile.secrets` references whose env var is unset (see EngineOptions.secretResolver). */
    secretResolver?: (name: string, agentId: string) => string | undefined | Promise<string | undefined>;

    /** Wait for a tool to wind down after its signal is aborted, before answering. Default 2000 ms. */
    toolTimeoutGraceMs?: number;

    /** Max parallel agent delegations via ask_agent. Default: 6. */
    maxParallelAgents?: number;

    /** Deepest nesting of ask_agent delegations. Default: 5. */
    maxDelegationDepth?: number;

    /**
     * Called before write/execute tools (tools that declare `readOnly: false`) and before
     * package installs. Return 'approve', 'approve_all' (stop prompting for this session) or
     * 'reject' to skip the tool call. Without it, no approval is requested.
     */
    onToolApproval?: (toolName: string, agentId: string, argsPreview: string) => Promise<ToolApprovalDecision>;

    /** Iteration mode. Default: 'interactive' (see IterationManager). */
    iterationMode?: IterationMode;
    /** Max concurrencySafe tool calls of one turn run at once. Default 1 (sequential). */
    maxParallelTools?: number;

    /**
     * Called when maxIterations is reached in 'interactive' mode.
     * Return true to continue (+25 iterations), false to stop.
     */
    onIterationLimit?: (stats: IterationStats) => Promise<boolean>;

    /** Called after every iteration in 'step-by-step' mode. Return true to continue. */
    onStep?: (stats: IterationStats) => Promise<boolean>;

    /**
     * Maximum number of messages to keep in conversation history (sliding window).
     * Oldest messages are dropped at user-turn boundaries to avoid orphaning tool
     * call / result pairs. A 'system' warn event is emitted when trimming occurs.
     * Default: 200 (not applied when `context` is set); 0 disables the cap. Recommended: 100 for interactive agents, 40–60 for
     * long-running autonomous agents.
     */
    maxContextMessages?: number;

    /**
     * Token-aware context control (see ContextOptions): truncates old bulky tool results, then summarizes
     * (or drops) the oldest turns to keep the history under `context.maxTokens`. Can be combined with
     * `maxContextMessages`.
     *
     * @example
     * context: { maxTokens: 60_000, summarizer: { provider: 'deepseek', model: 'deepseek-chat' } }
     */
    context?: ContextOptions;

    /**
     * Guardrails on user input, tool arguments, tool results and model answers; applied to the main agent
     * and every sub-agent. Ready-made: piiGuardrail, secretLeakGuardrail, promptInjectionGuardrail,
     * maxLengthGuardrail, denyListGuardrail, llmJudgeGuardrail.
     *
     * @example
     * guardrails: [secretLeakGuardrail(), piiGuardrail({ mode: 'redact' }), promptInjectionGuardrail()]
     */
    guardrails?: Guardrail[];

    /**
     * `after` (default): stream the answer and, if an output guardrail changes it, correct the stored
     * history and emit a `guardrail` event carrying the `replacement`. `buffer`: hold the tokens until the
     * answer is checked, so nothing unchecked is shown (no streaming).
     */
    guardrailOutputMode?: 'after' | 'buffer';

    /** Absolute path used as the working directory for tool calls. */
    workingDir?: string;

    /**
     * Extra directories (absolute paths) that file tools are allowed to access
     * beyond workingDir. E.g. the agent's home dir (~/.my-agent/).
     */
    additionalRoots?: string[];

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

    /** Dependencies for the tools of a vertical, read with `getService(ctx, key)`. See `EngineOptions.services`. */
    services?: EngineOptions['services'];

    /** Session ID for tracking and correlation. */
    sessionId?: string;

    /**
     * Legacy escape hatch: let an agent with an empty `allowedTools` and no `delegatesTo` call any registered
     * tool, as every agent could before. By default an agent can call only the tools it lists.
     */
    allowUnlistedTools?: boolean;

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
     * Abort the run when observability.costTracker.budget is exceeded: calls engine.abort(), emits
     * a `budget_exceeded` event, then your onBudgetExceeded. The call that crosses the limit still
     * completes (and is paid for) but its response is discarded. Default: false.
     */
    abortOnBudget?: boolean;

    /**
     * Where to get more agents from, read on the first run() and merged with `agents` (a later source overrides
     * an earlier agent with the same id). The engine reads no file by itself: a source is the adapter, e.g.
     * `fileAgentSource({ appName })` of `@backendkit-labs/agent-coding/cli`.
     */
    agentSources?: AgentSource[];

    /** Where to get more skills from, read on the first run() and merged with `skills` and `loadSkills`. */
    skillSources?: SkillSource[];

    /**
     * Where to get instruction layers (project instructions, user preferences...). They are sanitized and added to
     * the system prompt after the other sections, through a `systemPrompt` hook (SPEC-0014).
     */
    instructionSources?: InstructionSource[];

    /**
     * Number of recent messages from the orchestrator's conversation to inject
     * into each sub-agent call. Gives specialists visibility into previously
     * gathered data (file reads, command outputs) without requiring the
     * orchestrator to copy it manually into the ask_agent context field.
     * Sliced at a user-turn boundary. Default: 0.
     */
    subAgentContextMessages?: number;

    /**
     * Path to a JSON file where conversation history is persisted between sessions.
     * Loaded on construction; saved after each run() capped at maxContextMessages.
     * Use engine.clearHistory() to wipe both in-memory and on-disk state.
     */
    historyPath?: string;

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
     * @deprecated Writes up to 200 characters of the arguments in clear. Use `audit` (e.g. `new NdjsonAuditSink(path)`
     * or `new HashChainAuditSink(path)`). Kept unchanged until 0.40.
     */
    auditLog?: string;

    /**
     * Where every tool call and delegation is recorded, accepted or refused: one `AuditEvent` per call, with the
     * arguments as a SHA-256 only. See `NdjsonAuditSink`, `HashChainAuditSink`, `MemoryAuditSink`.
     */
    audit?: AuditSink | AuditSink[];

    /** Who the engine acts for (tenant, user, roles, scopes...). Part of the `Principal` of every call. */
    identity?: Identity;

    /**
     * Decides every tool call and delegation: allow, deny or ask (SPEC-0014). Several combine (deny > ask > allow).
     * Setting `policy`, `approver` or `approvals` switches to the policy path; with none of them `onToolApproval`
     * keeps its legacy behavior. Without `policy` but with someone to ask, `defaultToolPolicy` applies.
     */
    policy?: ToolPolicy | ToolPolicy[];

    /**
     * Learning from experience (`createLearning()`), wired in one option:
     *
     * - its sink joins `audit`: tool calls that fail, time out, are denied or blocked become experiences;
     * - its hook joins `hooks`: the lessons of each agent, within its tenant, are added to its system prompt;
     * - its policy joins the policy path, so the rules a person approved are enforced. This happens only when
     *   the engine is already on the policy path (`policy`, `approver` or `approvals` is set): `learning` alone
     *   never switches the approval behavior of the engine, and then approved tool rules are not enforced.
     */
    learning?: Learning;

    /** Answers an `ask` now (a person, a supervising agent, a service). Its answers are validated and audited. */
    approver?: Approver;

    /** Stores an `ask` as pending when nobody answers now; the call does not run until approved. */
    approvals?: ApprovalStore;

    /** See `AgentEngineOptions.emitSystemPrompt`. */
    emitSystemPrompt?: boolean;

    /**
     * Lifecycle hooks (SPEC-0014): beforeRun, systemPrompt, afterTurn (may force another pass), beforeTool,
     * afterTool, afterRun. Registration order; a throwing hook fails the turn.
     */
    hooks?: EngineHooks[];

    /** Most extra passes `afterTurn` hooks may force in one turn. Default 5. */
    maxHookContinues?: number;

    /**
     * Called by updateWorkingDir after the workingDir changes (e.g. /workspace switch).
     * Should return the new projectContext string built from the new cwd
     * (AGENT.md, session.md, store context, detected stack, etc.).
     * The engine updates opts.projectContext with the returned value so the
     * next system prompt reflects the switched project without an engine restart.
     */
    projectContextLoader?: (cwd: string) => Promise<string | undefined>;
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
 * For a fully configured coding agent, use createCodingEngine() from @backendkit-labs/agent-coding.
 */
export function createBaseEngine(opts: BaseEngineOptions): AgentEngine {
    const agents = new AgentRegistry();
    for (const agent of opts.agents ?? []) agents.upsert(agent);

    const tools = new ToolRegistry();
    for (const tool of opts.tools ?? []) tools.register(tool);
    if (opts.memorySystem) {
        for (const tool of opts.memorySystem.getTools()) tools.register(tool);
    }
    const jobs = opts.jobs ? createJobRegistry(opts.jobs === true ? {} : opts.jobs) : undefined;
    if (jobs) for (const tool of JOB_TOOLS) tools.register(tool);

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

    const baseTransport = opts.transport ?? new StdoutTransport();

    // abortOnBudget: wrap onBudgetExceeded so it can abort the engine, which does not exist yet.
    let engineRef: { abort(): void; reportBudgetExceeded(usage: import('../observability/types').BudgetUsage, announce?: boolean): void } | undefined;
    const userCost = opts.observability?.costTracker;
    const observability: ObservabilityConfig | undefined =
        opts.observability && userCost?.budget
            ? {
                ...opts.observability,
                costTracker: {
                    ...userCost,
                    // The engine always hears about it (`engine.budgetExceeded`, `RunResult.budgetExceeded`); it stops only if asked to.
                    onBudgetExceeded: (usage) => {
                        if (opts.abortOnBudget) engineRef?.abort();
                        engineRef?.reportBudgetExceeded(usage, !!opts.abortOnBudget);
                        userCost.onBudgetExceeded?.(usage);
                    },
                },
            }
            : opts.observability;

    // Wrap transport with observability if configured
    const obsManager = observability ? new ObservabilityManager(observability) : undefined;
    const transport = obsManager ? obsManager.wrapTransport(baseTransport) : baseTransport;

    if (userCost?.budget) {
        if (userCost.inputPricePerMToken === undefined && userCost.outputPricePerMToken === undefined) {
            baseTransport.emit({
                type: 'system', level: 'warn',
                text: 'observability.costTracker.budget is set but no token prices are configured (spread MODEL_PRICING[model] into costTracker): cost stays 0 and the budget never triggers.',
            });
        }
        if (userCost.budget.perDay !== undefined) {
            baseTransport.emit({
                type: 'system', level: 'warn',
                text: 'budget.perDay is tracked in memory only: it starts at zero on every process start.',
            });
        }
    }

    const engine = new AgentEngine({
        model: { provider: opts.defaultProvider, id: opts.defaultProvider },
        agents,
        tools,
        providers,
        defaultProvider: opts.defaultProvider,
        transport,
        defaultAgentId,
        workingDir: opts.workingDir,
        ...(opts.additionalRoots?.length ? { additionalRoots: opts.additionalRoots } : {}),
        maxIterations: opts.maxIterations ?? 100,
        maxParallelAgents: opts.maxParallelAgents ?? 6,
        ...(opts.maxDelegationDepth !== undefined ? { maxDelegationDepth: opts.maxDelegationDepth } : {}),
        ...(opts.onToolApproval ? { onToolApproval: opts.onToolApproval } : {}),
        ...(opts.iterationMode ? { iterationMode: opts.iterationMode } : {}),
        ...(opts.maxParallelTools ? { maxParallelTools: opts.maxParallelTools } : {}),
        ...(opts.toolTimeoutMs ? { toolTimeoutMs: opts.toolTimeoutMs } : {}),
        ...(opts.secretResolver ? { secretResolver: opts.secretResolver } : {}),
        ...(jobs ? { jobs } : {}),
        ...(opts.sandbox ? { sandbox: opts.sandbox } : {}),
        ...(opts.toolTimeoutGraceMs !== undefined ? { toolTimeoutGraceMs: opts.toolTimeoutGraceMs } : {}),
        ...(opts.abortOnBudget ? { abortOnBudget: true } : {}),
        ...(opts.onIterationLimit ? { onIterationLimit: opts.onIterationLimit } : {}),
        ...(opts.onStep ? { onStep: opts.onStep } : {}),
        ...(opts.maxContextMessages !== undefined ? { maxContextMessages: opts.maxContextMessages } : {}),
        ...(opts.context ? { context: opts.context } : {}),
        ...(opts.guardrails?.length ? { guardrails: opts.guardrails } : {}),
        ...(opts.guardrailOutputMode ? { guardrailOutputMode: opts.guardrailOutputMode } : {}),
        ...(opts.subAgentContextMessages ? { subAgentContextMessages: opts.subAgentContextMessages } : {}),
        ...(opts.historyPath ? { historyPath: opts.historyPath } : {}),
        projectContext: opts.projectContext,
        skills: opts.skills,
        detectedStack: opts.detectedStack,
        ...(opts.loadSkills || opts.skillSources?.length
            ? {
                loadSkills: async () => [
                    ...(opts.loadSkills ? await opts.loadSkills() : []),
                    ...(opts.skillSources?.length ? await listSkillSources(opts.skillSources) : []),
                ],
            }
            : {}),
        ...(opts.sessionMemory ? { sessionMemory: opts.sessionMemory } : {}),
        ...(opts.services ? { services: opts.services } : {}),
        ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
        ...(opts.allowUnlistedTools ? { allowUnlistedTools: true } : {}),
        ...(opts.mcpServers?.length
            ? { mcpManager: new MCPClientManager(opts.mcpServers) }
            : {}),
        ...(obsManager ? { observabilityManager: obsManager } : {}),
        ...(opts.memorySystem ? { memorySystem: opts.memorySystem } : {}),
        ...(opts.auditLog ? { auditLog: opts.auditLog } : {}),
        ...(opts.audit || opts.learning
            ? {
                audit: [
                    ...(opts.audit ? (Array.isArray(opts.audit) ? opts.audit : [opts.audit]) : []),
                    ...(opts.learning ? [opts.learning.sink] : []),
                ],
            }
            : {}),
        ...(opts.identity ? { identity: opts.identity } : {}),
        ...(opts.learning && (opts.policy || opts.approver || opts.approvals)
            ? {
                // Without a configured policy the engine would apply defaultToolPolicy: keep it, and add the learned rules.
                policy: [
                    ...(opts.policy ? (Array.isArray(opts.policy) ? opts.policy : [opts.policy]) : [defaultToolPolicy]),
                    opts.learning.policy,
                ],
            }
            : opts.policy ? { policy: opts.policy } : {}),
        ...(opts.approver ? { approver: opts.approver } : {}),
        ...(opts.approvals ? { approvals: opts.approvals } : {}),
        ...(opts.emitSystemPrompt ? { emitSystemPrompt: true } : {}),
        ...(opts.hooks?.length || opts.instructionSources?.length || opts.learning
            ? {
                hooks: [
                    ...(opts.instructionSources?.length
                        ? [instructionSourceHooks(opts.instructionSources, { cwd: opts.workingDir })]
                        : []),
                    ...(opts.hooks ?? []),
                    ...(opts.learning ? [opts.learning.hooks] : []),
                ],
            }
            : {}),
        ...(opts.maxHookContinues !== undefined ? { maxHookContinues: opts.maxHookContinues } : {}),
        ...(opts.projectContextLoader ? { projectContextLoader: opts.projectContextLoader } : {}),
        ...(opts.agentSources?.length ? { loadAgents: () => listAgentSources(opts.agentSources!) } : {}),
    });
    engineRef = engine;
    if (opts.learning) {
        for (const tool of opts.tools ?? []) if (tool.errorHints) opts.learning.registerHints(tool.name, tool.errorHints);
    }
    return engine;
}
