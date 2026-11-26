import { ApprovalGate } from './ApprovalGate';
import { GovernanceGate, type GovernedVerdict } from './GovernanceGate';
import { AuditLogger } from './AuditLogger';
import { HistoryManager, sanitizeMessages, DEFAULT_MAX_CONTEXT_MESSAGES } from './HistoryManager';
import { ContextManager, SUMMARY_SYSTEM_PROMPT, buildSummaryPrompt } from './ContextManager';
import { resolveSecrets } from './secrets';
import { isContextOverflowError } from './contextOverflow';
import { GuardrailRunner } from '../guardrails/GuardrailRunner';
import type { GuardrailOutcome, GuardrailPhase } from '../guardrails/types';
import { MCPRegistrar } from './MCPRegistrar';
import { randomUUID } from 'node:crypto';
import { AuditDispatcher } from '../governance/audit';
import { IdentityResolver, type AgentIdentity, type AgentIdentityProvider } from '../governance/agent-identity';
import { eventSigningMessage } from '../governance/agent-signature';
import { TOOL_SEARCH_NAME, TOOL_SEARCH_DEFAULT_RESULTS, isDeferred, rankTools, describeFound, toolSearchDefinition, type ToolSearchOptions } from './toolSearch';
import { declaredAskPolicy, defaultToolPolicy, evaluatePolicies } from '../governance/policy';
import { approverFromCallback, type CallbackApprover } from '../governance/approval';
import { DEFAULT_MAX_HOOK_CONTINUES, runHooks, type ContinueTurn, type EngineHooks, type RunContext } from '../governance/hooks';
import type {
    ApprovalStore,
    Approver,
    ApproverAuthority,
    ApproverDirectory,
    AuditCredential,
    AuditMandate,
    CredentialBroker,
    ApproverRef,
    AuditDecision,
    AuditEvent,
    AuditOutcome,
    AuditSandboxDecision,
    AuditSink,
    Identity,
    Principal,
    ToolCall,
    ToolPolicy,
} from '../governance/types';
import { hashArgs } from '../shared/utils/canonical-json';

import type {
    AgentProfile,
    EngineOptions,
    ExecutionContext,
    LLMMessage,
    LLMProvider,
    RunResult,
    SessionMemoryData,
    ToolDefinition,
    Skill,
} from '../types';
import type { BudgetUsage } from '../observability/types';
import type { Transport } from '../transport/Transport';
import type { AgentRegistry } from './AgentRegistry';
import type { ToolRegistry } from './ToolRegistry';
import { ProviderRegistry } from './ProviderRegistry';
import { DelegationBus } from '../delegation/DelegationBus';
import { SessionMemory } from '../memory/SessionMemory';
import { SkillActivator } from '../skills/activator';
import { MCPClientManager } from '../mcp/MCPClientManager';
import type { ObservabilityManager } from '../observability/ObservabilityManager';
import type { MemorySystem } from '../agent-memory/MemorySystem';
import type { CommandContext } from '../commands/SlashCommandRegistry';
import { WorkflowRunner } from '../workflow/WorkflowRunner';
import type { WorkflowDef, WorkflowResult, WorkflowRunOptions } from '../workflow/types';
import type { WorkflowBuilder } from '../workflow/WorkflowBuilder';
import { IterationManager, type IterationMode, type IterationStats } from './IterationManager';
import { errorCodeOf } from './error-code';
import { RunRecorder } from './run-recorder';


export interface AgentEngineOptions extends EngineOptions {
    agents: AgentRegistry;
    tools: ToolRegistry;
    /** Registry of all available providers */
    providers: ProviderRegistry;
    /** ID of the provider to use when an agent has no explicit provider set */
    defaultProvider: string;
    transport: Transport;
    defaultAgentId: string;
    /** Optional persistent memory — replaces the default in-memory SessionMemory */
    sessionMemory?: SessionMemoryData;
    /**
     * Legacy escape hatch. By default an agent can call ONLY the tools in its `allowedTools`; an empty list means
     * no tools. Before, an agent with an empty `allowedTools` and no `delegatesTo` could call any registered tool
     * (it was not offered any, but a call by name ran), so an agent written to have no tools had all of them.
     * Set true to keep that behavior while the profiles are fixed.
     */
    allowUnlistedTools?: boolean;
    /** How `tool_search` looks for deferred tools: a search of your own and the number of results (SPEC-0030). */
    toolSearch?: ToolSearchOptions;
    /** MCP client manager — connects to external MCP servers and registers their tools */
    mcpManager?: MCPClientManager;
    /**
     * Called before executing write/execute tools (tools that declare `readOnly: false`) when
     * iteration mode is 'manual'. Return 'approve' to run, 'approve_all' to run and disable
     * further prompts this session, 'reject' to skip the tool call.
     */
    onToolApproval?: (toolName: string, agentId: string, argsPreview: string) => Promise<import('../types').ToolApprovalDecision>;
    /**
     * Iteration mode. Default: 'interactive'.
     *   interactive  — pauses every maxIterations steps and calls onIterationLimit so the
     *                  user can inspect progress and decide whether to continue (+batchSize more)
     *   auto         — never pauses; runs until the agent finishes or hits the global cap (1000)
     *   step-by-step — calls onStep after every single iteration; maximum user control
     */
    iterationMode?: IterationMode;
    /**
     * Max concurrencySafe tool calls of one turn run at once. Default 1 (sequential).
     */
    maxParallelTools?: number;
    /** Stop before the next LLM call once the run cost reached observability budget.perRun. */
    abortOnBudget?: boolean;
    /**
     * Called when maxIterations is reached in interactive mode.
     * Return true to continue (+25 iterations), false to stop.
     */
    onIterationLimit?: (stats: IterationStats) => Promise<boolean>;
    /**
     * Called after every iteration in step-by-step mode.
     * Return true to continue, false to stop.
     */
    onStep?: (stats: IterationStats) => Promise<boolean>;
    /** Observability manager — pre-created and transport-wrapped by createBaseEngine */
    observabilityManager?: ObservabilityManager;
    /** Advanced memory system — episodic/semantic/procedural */
    memorySystem?: MemorySystem;
    /**
     * Extra directories (absolute paths) that file tools are allowed to access
     * beyond workingDir. Useful for exposing ~/.{agentName}/ or shared library
     * roots to the agent without changing workingDir.
     */
    additionalRoots?: string[];
    /** Called once on the first run/runWorkflow to load discovered agents from disk or remote. */
    loadAgents?: () => Promise<import('../types').AgentProfile[]>;
    /**
     * Path to an append-only NDJSON file for tool call audit records.
     * Each executed tool call is appended as one JSON line with: ts, session, agent, tool, inputPreview, success, durationMs.
     * Directory is created automatically. Optional — no audit file written when absent.
     * @deprecated Writes up to 200 characters of the arguments in clear. Use `audit` (an `AuditSink`, e.g.
     * `new NdjsonAuditSink(path)` or `new HashChainAuditSink(path)`), whose events carry only a hash of the
     * arguments. Kept unchanged, same file format, until 0.40.
     */
    auditLog?: string;
    /**
     * Where every tool call (and every `ask_agent` delegation) is recorded, accepted or refused: exactly one
     * `AuditEvent` per call, arguments as a SHA-256 only. Several sinks receive the same events in the same order.
     */
    audit?: AuditSink | AuditSink[];
    /** Who this engine acts for (tenant, user, roles...). Becomes part of the `Principal` of every call. */
    identity?: Identity;
    /**
     * Gives each agent its digital identity (SPEC-0044). Every call is attributed to it in the audit and the policies see it in
     * `principal.agentIdentity`. See `staticAgentIdentities`, `selfAssertedIdentities`.
     */
    agentIdentity?: AgentIdentityProvider;
    /**
     * Default `true`: an agent with no identity, or that does not say on whose behalf it acts (`identity.userId`), is denied, with a reason that
     * says how to fix it. `false` is for tests: not suitable for regulated environments.
     */
    requireAgentIdentity?: boolean;
    /** How long the identity provider has to answer before the call is denied. Default 5000. */
    agentIdentityTimeoutMs?: number;
    /** How long an answer of the provider is reused. Default 5000; `0` asks on every call. */
    agentIdentityCacheMs?: number;
    /**
     * Default `true`: when the identity provider can sign, every audit event is signed by the identity that executed the call, and the engine
     * waits for that signature (SPEC-0044 F2). `false` records only the identity, for a custody too slow to wait for: sign the head of the chain
     * every N events instead (`HashChainAuditSink` with an asynchronous `CheckpointSigner`).
     */
    signAuditEvents?: boolean;
    /**
     * Decides every tool call and delegation (allow, deny, ask) after allowedTools, the sandbox and the argument
     * guardrails. Several policies combine: deny wins, then ask, then allow. When absent but there is someone to
     * ask (`approver`, `approvals` or `onToolApproval`), `defaultToolPolicy` applies: readOnly runs, everything else
     * asks, destructive asks a person. Setting any of `policy`, `approver` or `approvals` switches the engine to this
     * path; with none of them the legacy `onToolApproval` gate keeps working exactly as before.
     */
    policy?: ToolPolicy | ToolPolicy[];
    /**
     * Who answers an `ask` right away: a person through a UI, a supervising agent, a service such as Hermes. Its
     * answers are checked (accepted kind, no self-approval, an agent approves only what it can do) and audited.
     * Without it, `onToolApproval` is adapted as the approver.
     */
    approver?: Approver;
    /** Who an approver is and what roles it holds. Needed when an `ask` carries `approverRoles` (SPEC-0041). */
    approverDirectory?: ApproverDirectory;
    /** The person an agent acts for does not approve what it asked for (SPEC-0041 F2). */
    forbidSelfApproval?: boolean;
    /** Leases the credentials a tool declares, for one authorized call (SPEC-0042 F4). */
    credentialBroker?: CredentialBroker;
    /** Seconds a stored request lives before an approval of it is not run. Default: it does not expire (SPEC-0042 F3). */
    approvalTtlSeconds?: number;
    /**
     * Milliseconds a live approver (`approver`) has to answer. Past that the call is denied. Without it an approver that never
     * answers holds every other approval of the engine behind it. Default: no limit.
     */
    approverTimeoutMs?: number;
    /**
     * Durable approvals: when nobody answers right away, an `ask` is stored here as pending and the model is told
     * the call did not run (resubmission, SPEC-0014 §6).
     */
    approvals?: ApprovalStore;
    /**
     * Lifecycle hooks (SPEC-0014 §3): before/after a turn, system prompt sections, after the model's final answer
     * (may force another pass), before/after each tool call. Run in registration order; a throwing hook fails the turn.
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

    /**
     * Emit a `system_prompt` event with the system prompt of every model call. It is how you check what the agent really saw
     * (the lessons and the memory that reached it). Off by default: a system prompt can carry secrets, and the event goes to
     * every transport.
     */
    emitSystemPrompt?: boolean;
    /**
     * Put the arguments of each tool call in `RunResult.toolCalls[].args` (SPEC-0021 D7). They are not added to the `tool_result`
     * event, so no transport receives them. Off by default: the arguments can carry sensitive data. For tests and evaluations.
     */
    recordArgs?: boolean;
}

const MAX_INPUT_BYTES = 100_000; // Fix #17: 100 KB hard cap on user input

const ASK_AGENT_TOOL: ToolDefinition = {
    name: 'ask_agent',
    description:
        'Invokes another AI agent in the system. Multiple ask_agent calls in the same response ' +
        'run concurrently (up to 6 at a time via a bulkhead). Use to split large independent ' +
        'tasks across 2-5 specialist agents per response.',
    parameters: {
        type: 'object',
        properties: {
            agent_id: { type: 'string', description: 'ID of the agent to invoke' },
            question: { type: 'string', description: 'The task or question for the agent' },
            context: { type: 'string', description: 'Additional context the agent needs' },
        },
        required: ['agent_id', 'question'],
    },
    // Delegating changes nothing by itself: what the delegate does is decided and audited call by call. So the
    // default policy lets delegation through; an explicit policy still sees it (tool name 'ask_agent').
    readOnly: true,
    execute: async () => '',
};

/** The arguments of a delegation, as `ask_agent` takes them: what its policies see and its audit event records. */
function delegationArgs(c: { agentId: string; question: string; context?: string }): Record<string, unknown> {
    return { agent_id: c.agentId, question: c.question, ...(c.context !== undefined ? { context: c.context } : {}) };
}

import type { ZodType } from 'zod';
import { generateObject } from '../structured/generateObject';

const MAX_OVERFLOW_RETRIES = 2;

/** What the engine knows about one LLM call, for tracing. */
interface LlmCallInfo {
    agentId?: string;
    provider?: string;
    model?: string;
    purpose?: string;
    /** Epoch ms when the call started; the duration is measured when the `metrics` event is built. */
    startedAt?: number;
}

/** `metrics` event; cache fields are included only when the provider reported them. */
function metricsEvent(
    inputTokens: number,
    outputTokens: number,
    usage?: import('../types').LLMUsageDetails,
    extra?: LlmCallInfo,
): import('../types').AgentEvent {
    return {
        type: 'metrics',
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        ...(extra?.agentId ? { agent_id: extra.agentId } : {}),
        ...(extra?.provider ? { provider: extra.provider } : {}),
        ...(extra?.model ? { model: extra.model } : {}),
        ...(extra?.purpose ? { purpose: extra.purpose } : {}),
        ...(extra?.startedAt !== undefined ? { started_at: extra.startedAt, duration_ms: Math.max(0, Date.now() - extra.startedAt) } : {}),
        ...(usage?.cacheReadTokens !== undefined ? { cache_read_tokens: usage.cacheReadTokens } : {}),
        ...(usage?.cacheWriteTokens !== undefined ? { cache_write_tokens: usage.cacheWriteTokens } : {}),
    };
}

export class AgentEngine {
    private readonly memory: SessionMemoryData;
    private readonly bus: DelegationBus;
    private readonly skillActivator = new SkillActivator();
    private readonly history: HistoryManager;
    private readonly contextManager?: ContextManager;
    private readonly guardrails?: GuardrailRunner;
    /** Uncalibrated token estimate of the last request sent by runLoop, to calibrate against real usage. */
    private lastRequestEstimate = 0;
    private readonly auditLogger: AuditLogger;
    private readonly audit: AuditDispatcher;
    private readonly identities: IdentityResolver;
    /** Policy path (SPEC-0014 F2) instead of the legacy ApprovalGate: on when policy, approver or approvals is set. */
    private readonly governed: boolean;
    private readonly policies: ToolPolicy[];
    private readonly approver?: Approver;
    private readonly gate: GovernanceGate;
    /** Set when the approver is the adapted onToolApproval callback, so disable/enableToolApproval reach it. */
    private readonly callbackApprover?: CallbackApprover;
    private readonly hooks: EngineHooks[];
    /** Context shared by the hooks of the turn in progress; undefined between turns. */
    private runCtx?: RunContext;
    private runController?: AbortController;
    /** Last final answer of the model in the current turn (for afterRun). */
    private lastAnswer = '';
    private currentAgentId: string;
    private aborted = false;
    private abortController: AbortController | null = null;
    /** One per in-flight sub-agent LLM call, so abort() reaches delegations that run inside a tool call. */
    private readonly subAgentControllers = new Set<AbortController>();
    /** One controller per tool call in flight (main agent and sub-agents); see `runToolDef`. */
    private readonly toolControllers = new Set<AbortController>();
    private allSkills: Skill[];
    private iterationManager: IterationManager;
    private activeSkillAddition = '';
    private yamlSkillsLoaded = false;
    private readonly mcpRegistrar: MCPRegistrar;
    private readonly approvalGate: ApprovalGate;
    private pendingContextLoad: Promise<void> | null = null;
    private agentsLoaded = false;
    private agentsLoadedPromise: Promise<void> | null = null;
    private memoryContextBlock = '';
    /** Serializes concurrent run() calls — shared mutable state is not reentrant-safe. */
    private runMutex: Promise<void> = Promise.resolve();

    /** What the engine emits to: the transport of the caller, with the events of the current run also collected. */
    private readonly transport: Transport;
    private recorder?: RunRecorder;
    /** The id of the run in progress; undefined outside `run()`. */
    private currentRunId?: string;
    private budgetHit = false;
    /** Deferred tools each agent found with `tool_search` in this run, in the order found (SPEC-0030). Cleared when a run starts. */
    private readonly discovered = new Map<string, string[]>();

    constructor(private readonly opts: AgentEngineOptions) {
        if (opts.approvalTtlSeconds !== undefined && !(Number.isFinite(opts.approvalTtlSeconds) && opts.approvalTtlSeconds > 0)) {
            throw new Error('approvalTtlSeconds must be a positive number of seconds');
        }
        if (opts.approverTimeoutMs !== undefined && !(Number.isFinite(opts.approverTimeoutMs) && opts.approverTimeoutMs > 0)) {
            throw new Error('approverTimeoutMs must be a positive number of milliseconds');
        }
        this.transport = {
            emit: (event) => { this.recorder?.push(event); opts.transport.emit(event); },
            onInput: (cb) => opts.transport.onInput(cb),
            close: () => opts.transport.close(),
        };
        this.memory = opts.sessionMemory ?? new SessionMemory();
        this.currentAgentId = opts.defaultAgentId;
        this.allSkills = opts.skills ?? [];
        this.history = new HistoryManager({
            historyPath:        opts.historyPath,
            maxContextMessages: opts.maxContextMessages,
        });
        if (opts.guardrails?.length) this.guardrails = new GuardrailRunner(opts.guardrails);
        if (opts.context) {
            this.contextManager = new ContextManager(opts.context, {
                history: this.history,
                summarize: (transcript, previous) => this.summarizeForContext(transcript, previous),
                emit: (event) => this.transport.emit(event),
            });
        }
        this.auditLogger = new AuditLogger(opts.auditLog);
        // A sink that fails must not change what the agent already did, but it must not fail silently either.
        this.audit = new AuditDispatcher(opts.audit, (err) => this.transport.emit({
            type: 'system', level: 'warn',
            text: `[audit] a sink failed to record a tool call: ${err instanceof Error ? err.message : String(err)}`,
        }));
        this.identities = new IdentityResolver({
            ...(opts.agentIdentity ? { provider: opts.agentIdentity } : {}),
            ...(opts.requireAgentIdentity !== undefined ? { require: opts.requireAgentIdentity } : {}),
            ...(opts.agentIdentityTimeoutMs !== undefined ? { timeoutMs: opts.agentIdentityTimeoutMs } : {}),
            ...(opts.agentIdentityCacheMs !== undefined ? { cacheMs: opts.agentIdentityCacheMs } : {}),
            warn: (text) => this.transport.emit({ type: 'system', level: 'warn', text }),
        });
        this.hooks = opts.hooks ?? [];
        this.governed = !!(opts.policy || opts.approver || opts.approvals);
        if (this.governed) {
            const someoneToAsk = !!(opts.approver || opts.approvals || opts.onToolApproval);
            const configured = opts.policy ? (Array.isArray(opts.policy) ? opts.policy : [opts.policy]) : [];
            // What a tool declares with `alwaysAsk` always asks a person, whatever the configured policy says.
            this.policies = [
                ...(configured.length > 0 ? configured : someoneToAsk ? [defaultToolPolicy] : []),
                declaredAskPolicy,
            ];
            if (opts.approver) {
                this.approver = opts.approver;
            } else if (opts.onToolApproval) {
                this.callbackApprover = approverFromCallback(opts.onToolApproval);
                this.approver = this.callbackApprover;
            }
        } else {
            this.policies = [];
        }
        this.mcpRegistrar = new MCPRegistrar({
            mcpManager: opts.mcpManager,
            tools:      opts.tools,
            agents:     opts.agents,
            transport:  this.transport,
        });
        this.approvalGate = new ApprovalGate({
            onToolApproval: opts.onToolApproval,
            transport:      this.transport,
        });
        this.gate = new GovernanceGate({
            policies: this.policies,
            approver: this.approver,
            approvals: opts.approvals,
            approverDirectory: opts.approverDirectory,
            credentialBroker: opts.credentialBroker,
            forbidSelfApproval: opts.forbidSelfApproval,
            approvalTtlSeconds: opts.approvalTtlSeconds,
            approverTimeoutMs: opts.approverTimeoutMs,
            hasSandbox: !!opts.sandbox,
            sandboxApprovalFor: opts.sandbox?.approvalFor
                ? (who, tool) => opts.sandbox!.approvalFor!(who, tool)
                : undefined,
            agents: opts.agents,
            transport: this.transport,
            principalFor: (agentId, chain) => this.principalFor(agentId, chain),
            noApproverForSandbox: (tool, agentId, decisions) => this.noApproverForSandbox(tool, agentId, decisions),
        });
        this.iterationManager = new IterationManager({
            mode: opts.iterationMode ?? 'interactive',
            maxIterations: opts.maxIterations ?? 100,
            onLimitReached: opts.onIterationLimit,
            onStep: opts.onStep,
        });
        this.bus = new DelegationBus({
            maxParallel: opts.maxParallelAgents ?? 6,
            maxDepth: opts.maxDelegationDepth,
            agents: opts.agents,
            transport: this.transport,
            runAgent: (id, question, context, depth, buf, chain) => this.runAgentInternal(id, question, context, depth, buf, chain),
        });
    }

    /**
     * Asks the agent's provider for an object matching `schema` (validated with zod, one corrective
     * retry) and reports the token usage as `metrics` events. It does not touch the conversation history.
     * Throws `StructuredOutputError` when the model never produces a valid object.
     */
    async generateObject<T>(
        prompt: string,
        schema: ZodType<T>,
        opts: { agentId?: string; retries?: number; name?: string } = {},
    ): Promise<T> {
        const agentId = opts.agentId ?? this.opts.defaultAgentId;
        const profile = this.opts.agents.get(agentId);
        if (!profile) throw new Error(`Agent "${agentId}" not registered`);
        const provider = this.getProviderForProfile(profile);
        let attemptStart = Date.now();
        return generateObject(provider, prompt, schema, {
            retries: opts.retries,
            name: opts.name,
            model: profile.model,
            onMetrics: (inputTokens, outputTokens, usage) => {
                this.transport.emit(metricsEvent(inputTokens, outputTokens, usage, {
                    agentId, provider: profile.provider ?? this.opts.defaultProvider,
                    model: profile.model ?? provider.modelId, purpose: 'structured_output', startedAt: attemptStart,
                }));
                attemptStart = Date.now();
            },
        });
    }

    /** Access the observability manager when configured via createBaseEngine({ observability }). */
    get observability(): ObservabilityManager | undefined {
        return this.opts.observabilityManager;
    }

    /** Access the MCP client manager to inspect connected servers and their tools. */
    getMCPManager(): MCPClientManager | undefined {
        return this.opts.mcpManager;
    }

    /**
     * Access the tool registry.
     *
     * Lets a consumer inspect, wrap or replace tool definitions (for example to add
     * containment checks or approval requirements) without forking the framework:
     * `registry.unregister(name)` + `registry.register(guardedDefinition)`.
     */
    getTools(): ToolRegistry {
        return this.opts.tools;
    }

    /**
     * Updates the working directory used by tools and the system prompt.
     * Call after a workspace/project switch so file operations target the new
     * project root without recreating the entire engine.
     * Also triggers a skill reload so project-scoped skills are refreshed.
     * If projectContextLoader is configured, fires it asynchronously so the next
     * run() picks up the new project's AGENT.md / session.md content.
     */
    updateWorkingDir(newCwd: string): void {
        (this.opts as { workingDir?: string }).workingDir = newCwd;
        this.reloadSkills();
        if (this.opts.projectContextLoader) {
            this.pendingContextLoad = this.opts.projectContextLoader(newCwd)
                .then(ctx => {
                    if (ctx !== undefined) {
                        (this.opts as { projectContext?: string }).projectContext = ctx;
                    }
                })
                .catch(() => { /* non-fatal — next run continues without updated context */ })
                .finally(() => { this.pendingContextLoad = null; });
        }
    }

    /**
     * Injects an informational message into the active conversation history so
     * the agent sees it on the next iteration. Used by /workspace switch and any
     * command that needs to surface state changes (cwd, project context, etc.)
     * without requiring a full engine restart.
     */
    injectContext(message: string): void {
        this.history.inject(message);
    }

    /**
     * Returns a partial CommandContext pre-wired to this engine instance.
     * Spread into the registry.dispatch() call so host apps don't need to
     * manually wire onCwdChange, injectContext, setIterationMode, etc.:
     *
     *   await registry.dispatch(input, {
     *     ...engine.getCommandBindings(),
     *     emit, appName: 'my-agent',
     *   });
     */
    getCommandBindings(): Partial<CommandContext> {
        return {
            workingDir:       this.opts.workingDir,
            onCwdChange:      (cwd: string, contextMessage?: string) => {
                this.updateWorkingDir(cwd);
                if (contextMessage) this.injectContext(contextMessage);
            },
            injectContext:    (message: string) => this.injectContext(message),
            setIterationMode: (mode) => this.setIterationMode(mode),
            getIterationMode: () => this.getIterationMode(),
            llm:              (prompt: string) => this.callLLM(prompt),
            reloadSkills:     async () => { this.reloadSkills(); },
            mcpList:          async () => {
                const mgr = this.opts.mcpManager;
                if (!mgr) return [];
                const configured = mgr.getConfiguredNames();
                const connected  = new Map(
                    mgr.getServerInfo().map(s => [s.name, s.toolCount])
                );
                return configured.map(name => ({
                    name,
                    url:       mgr.getConfig(name)?.url,
                    connected: connected.has(name),
                    toolCount: connected.get(name) ?? 0,
                }));
            },
        };
    }

    /**
     * Marks YAML skills as stale so the next run() reloads them from disk.
     * Call after installing, creating, or generating skills so changes take effect
     * without restarting the engine.
     * Built-in (in-memory) skills are never affected — only the YAML layers are reloaded.
     */
    reloadSkills(): void {
        const builtins = this.opts.skills ?? [];
        this.allSkills = [...builtins];
        this.yamlSkillsLoaded = false;
    }

    /**
     * Direct single-turn LLM call — no tools, no conversation history, no transport events.
     * Useful for slash commands that need AI-generated content (e.g. /skills generate).
     * Uses the engine's default provider and model.
     */
    async callLLM(prompt: string): Promise<string> {
        return this.singleCall(this.opts.providers.resolve(undefined, this.opts.defaultProvider), prompt, {
            provider: this.opts.defaultProvider, purpose: 'call_llm',
        });
    }

    /**
     * One prompt, no tools, outside the conversation. Like every other LLM call of the engine it reports its tokens as a `metrics`
     * event (the budget and the cost are counted from those), stops with `abort()` while a run is going on, and fails with the
     * provider's error, also when the provider rejects instead of calling `onError`.
     */
    private singleCall(provider: LLMProvider, prompt: string, info: LlmCallInfo, model?: string): Promise<string> {
        const startedAt = Date.now();
        const signal = this.runController?.signal;
        return new Promise<string>((resolve, reject) => {
            const chunks: string[] = [];
            Promise.resolve(provider.chat(
                [{ role: 'user', content: prompt }],
                [],
                {
                    onChunk: (delta) => { chunks.push(delta); },
                    onDone: () => resolve(chunks.join('')),
                    onError: reject,
                    onMetrics: (inputTokens, outputTokens, usage) => {
                        this.transport.emit(metricsEvent(inputTokens, outputTokens, usage, {
                            ...info, model: model ?? info.model ?? provider.modelId, startedAt,
                        }));
                    },
                    ...(signal ? { signal } : {}),
                    ...(model ? { model } : {}),
                },
            )).catch(reject);
        });
    }

    private getProviderForProfile(profile: AgentProfile): LLMProvider {
        return this.opts.providers.resolve(profile.provider, this.opts.defaultProvider);
    }

    /**
     * Runs one turn. Every run has an id (`RunResult.runId`), the same one the audit events and the spans of the run carry (SPEC-0039).
     * Pass `options.runId` to use your own, for example the id of the flow run this turn belongs to; otherwise the engine makes one.
     */
    async run(input: string, options: { runId?: string } = {}): Promise<RunResult> {
        // Serialize concurrent calls — messages, currentAgentId, and other fields are
        // shared mutable state that is not safe for concurrent access.
        let release!: () => void;
        const slot = new Promise<void>(r => { release = r; });
        const prev = this.runMutex;
        this.runMutex = prev.then(() => slot);
        await prev;
        // One collector per turn, set once the turn owns the engine: every exit of `_run` (blocked input, a route to an agent,
        // an abort, an error) ends here, and the events of delegates are part of the turn.
        const recorder = new RunRecorder();
        this.recorder = recorder;
        const runId = options.runId ?? randomUUID();
        this.currentRunId = runId;
        this.discovered.clear();
        try {
            await this._run(input);
        } finally {
            this.recorder = undefined;
            this.currentRunId = undefined;
            release();
        }
        return recorder.result(this.aborted, runId);
    }

    /** The cost budget was exceeded at some point (`observability.costTracker.budget`). It stays true. */
    get budgetExceeded(): boolean {
        return this.budgetHit;
    }

    /**
     * Called by the engine's own budget wiring (`createBaseEngine`): remembers it for `engine.budgetExceeded` and the result of the
     * run. It tells the transport only when `announce` (the `budget_exceeded` event has always been tied to `abortOnBudget`).
     */
    reportBudgetExceeded(usage: BudgetUsage, announce = true): void {
        this.budgetHit = true;
        this.recorder?.markBudgetExceeded();
        if (announce) this.transport.emit({ type: 'budget_exceeded', usage });
    }

    private async _run(input: string): Promise<void> {
        if (this.pendingContextLoad) await this.pendingContextLoad;
        this.aborted = false;
        this.transport.emit({ type: 'ready', ...(this.currentRunId ? { run_id: this.currentRunId } : {}) });

        // Fix #17: reject inputs that exceed the hard cap to prevent prompt injection via huge payloads
        if (Buffer.byteLength(input, 'utf-8') > MAX_INPUT_BYTES) {
            this.transport.emit({
                type: 'error',
                message: `Input too large (${Buffer.byteLength(input, 'utf-8').toLocaleString()} bytes). Maximum is ${MAX_INPUT_BYTES.toLocaleString()} bytes.`,
            });
            this.transport.emit({ type: 'done' });
            return;
        }

        if (this.guardrails?.has('input')) {
            const checked = await this.guard('input', input, this.currentAgentId);
            if (checked.blocked) {
                this.transport.emit({
                    type: 'error',
                    message: `Input blocked by guardrail "${checked.blocked.guardrail}": ${checked.blocked.reason}`,
                });
                this.transport.emit({ type: 'done' });
                return;
            }
            input = checked.content;
        }

        await this.mcpRegistrar.ensureInitialized();
        await this.ensureAgentsLoaded();

        // Direct MCP routing: bypass general when input matches a configured trigger
        const mcpRoute = this.mcpRegistrar.findRoute(input);
        if (mcpRoute) {
            if (mcpRoute.tool) {
                // Tool trigger: call the MCP tool directly — no intermediate LLM.
                // Route through executeToolCall so auth checks and onToolApproval gate apply.
                const toolName = `mcp__${mcpRoute.agentId}__${mcpRoute.tool}`;
                const toolDef = this.opts.tools.get(toolName);
                if (toolDef) {
                    const required = (toolDef.parameters as { required?: string[] }).required;
                    const firstParam = required?.[0] ?? 'input';
                    const mcpProfile = this.opts.agents.get(mcpRoute.agentId) ?? this.getCurrentProfile();
                    if (!mcpProfile) {
                        throw new Error(
                            `MCP route matched agent "${mcpRoute.agentId}", but it is not registered ` +
                            `and no current agent profile is available.`
                        );
                    }
                    this.transport.emit({
                        type: 'block_start',
                        agent_id: mcpRoute.agentId,
                        agent_name: mcpProfile.name ?? mcpRoute.agentId,
                        agent_icon: mcpProfile.icon ?? '◎',
                    });
                    const result = await this.executeToolCall(
                        { name: toolName, args: JSON.stringify({ [firstParam]: input }) },
                        mcpProfile,
                    );
                    this.transport.emit({ type: 'token', content: result, agent_id: mcpRoute.agentId });
                    this.transport.emit({ type: 'block_end', status: 'ok', agent_id: mcpRoute.agentId });
                    this.transport.emit({ type: 'done' });
                    return;
                }
            }
            // Agent trigger fallback: route to the agent's LLM session
            await this.runAgentInternal(mcpRoute.agentId, input);
            this.transport.emit({ type: 'done' });
            return;
        }

        // Pre-compute memory context block for this input
        if (this.opts.memorySystem) {
            this.memoryContextBlock = await this.opts.memorySystem.buildContextBlock(input).catch(() => '');
        }

        // Lazy-load user YAML skills (global + packs + project) on first call
        if (!this.yamlSkillsLoaded && this.opts.loadSkills) {
            try {
                const yamlSkills = await this.opts.loadSkills();
                this.allSkills = [...this.allSkills, ...yamlSkills];
            } catch { /* non-fatal: skip if filesystem skills unavailable */ }
            this.yamlSkillsLoaded = true;
        }

        // Activate skills relevant to this specific input
        if (this.allSkills.length > 0) {
            const active = this.skillActivator.activate(
                input,
                this.allSkills,
                this.opts.detectedStack ?? [],
            );
            this.activeSkillAddition = this.skillActivator.buildSystemPromptAddition(active);
        }

        const profile = this.getCurrentProfile();
        if (!profile) throw new Error(`Default agent "${this.currentAgentId}" not registered`);

        // Hooks of this turn share one context (SPEC-0014 F3). A throwing hook fails the turn.
        this.runController = new AbortController();
        this.lastAnswer = '';
        this.runCtx = {
            principal: this.principalFor(profile.id),
            input,
            state: new Map(),
            signal: this.runController.signal,
            hasAgent: (id) => this.opts.agents.has(id),
            emit: (event) => this.transport.emit(event),
        };
        try {
            await runHooks(this.hooks, 'beforeRun', h => h.beforeRun!(this.runCtx!));

            this.history.push({ role: 'user', content: input });
            await this.runLoop(profile);
            this.saveHistory();

            const finished = this.runCtx;
            await runHooks(this.hooks, 'afterRun', h => h.afterRun!(finished, { text: this.lastAnswer }));
        } finally {
            this.runCtx = undefined;
            this.runController = undefined;
        }
        this.transport.emit({ type: 'done' });
    }

    /** Sections the `systemPrompt` hooks add for `profile`. */
    private async hookPromptSections(profile: AgentProfile): Promise<string[]> {
        if (!this.runCtx || !this.hooks.some(h => h.systemPrompt)) return [];
        const ctx = this.runCtx;
        const sections = await runHooks(this.hooks, 'systemPrompt', h => h.systemPrompt!(ctx, profile));
        return sections.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
    }

    /** The first `afterTurn` hook that asks to continue wins; the rest still run (they may only observe). */
    private async afterTurnHooks(profile: AgentProfile, text: string): Promise<ContinueTurn | undefined> {
        if (!this.runCtx || !this.hooks.some(h => h.afterTurn)) return undefined;
        const ctx = this.runCtx;
        const answers = await runHooks(this.hooks, 'afterTurn', h => h.afterTurn!(ctx, { text, profile }));
        return answers.find((a): a is ContinueTurn => !!a && (a as ContinueTurn).action === 'continue');
    }

    /** Arguments the model produced, as an object (anything else becomes `{}`). */
    private parseArgs(raw: string): Record<string, unknown> {
        try {
            const parsed = JSON.parse(raw) as unknown;
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
        } catch {
            return {};
        }
    }

    /** Context for a tool hook: the turn's context with the principal of the agent that makes the call. */
    private toolHookContext(principal: Principal): RunContext {
        return this.runCtx
            ? { ...this.runCtx, principal }
            : { principal, input: '', state: new Map(), signal: new AbortController().signal, hasAgent: (id) => this.opts.agents.has(id), emit: (e) => this.transport.emit(e) };
    }

    async runWorkflow(
        defOrBuilder: WorkflowDef | WorkflowBuilder,
        opts: WorkflowRunOptions = {},
    ): Promise<WorkflowResult> {
        if (this.pendingContextLoad) await this.pendingContextLoad;
        await this.mcpRegistrar.ensureInitialized();
        await this.ensureAgentsLoaded();
        const def = 'build' in defOrBuilder ? defOrBuilder.build() : defOrBuilder;
        const runner = new WorkflowRunner(def, {
            ...opts,
            runAgent: (agentId, input, context) => this.runAgentInternal(agentId, input, context, 0),
            transport: this.transport,
        });
        return runner.run();
    }

    /**
     * Runs a tool call that was stored as pending and has since been approved (SPEC-0014 §6, resubmission).
     *
     * - At most once: the store marks it executed atomically before it runs; a second call throws.
     * - Everything is checked again (allowedTools, sandbox, guardrails, policies); the stored approval only
     *   satisfies an `ask`, and only if its approver is one that ask accepts. An approval that turns out not to be
     *   valid is consumed and audited as `deny`.
     * - The result is returned to the caller (e.g. Hermes or a UI); it is not added to the conversation.
     */
    async runApproved(approvalId: string): Promise<string> {
        const store = this.opts.approvals;
        if (!store) throw new Error('runApproved needs an approvals store');
        await this.mcpRegistrar.ensureInitialized();
        await this.ensureAgentsLoaded();
        const item = await store.get(approvalId);
        if (!item) throw new Error(`approval "${approvalId}" does not exist`);
        if (item.status === 'executed') throw new Error(`approval "${approvalId}" was already executed`);
        if (item.status !== 'approved' || !item.outcome) throw new Error(`approval "${approvalId}" is ${item.status}, not approved`);
        const subject = item.subject;
        if (subject.kind !== 'tool_call' || !('call' in subject)) {
            throw new Error(`approval "${approvalId}" is a ${subject.kind}; only tool calls are resumed by the engine`);
        }
        const profile = this.opts.agents.get(item.principal.agentId);
        if (!profile) throw new Error(`agent "${item.principal.agentId}" of approval "${approvalId}" is not registered`);
        if (!(await store.markExecuted(approvalId))) throw new Error(`approval "${approvalId}" was already executed`);
        const approved: NonNullable<ToolCall['approved']> = { by: item.outcome.by, approvalId, ...(item.outcome.reason ? { reason: item.outcome.reason } : {}), ...(item.principal.userId !== undefined ? { requestedBy: item.principal.userId } : {}), ...(item.expiresAt !== undefined ? { expiresAt: item.expiresAt } : {}) };
        // A delegation is not a tool of the registry: it is run as one, through the same check as when it was asked.
        if (subject.call.tool.name === ASK_AGENT_TOOL.name) return this.runApprovedDelegation(profile, subject.call.args, item.principal.chain, approved);
        return this.executeToolCall(
            { name: subject.call.tool.name, args: JSON.stringify(subject.call.args) },
            profile, 0, undefined, undefined, item.principal.chain, approved,
        );
    }

    /** `runApproved` for an `ask_agent` that waited for approval: checked again (with the stored approval), delegated, audited once. */
    private async runApprovedDelegation(
        profile: AgentProfile, args: Record<string, unknown>, chain: string[], approved: NonNullable<ToolCall['approved']>,
    ): Promise<string> {
        const startedAt = Date.now();
        const call = {
            agentId: typeof args.agent_id === 'string' ? args.agent_id : '',
            question: typeof args.question === 'string' ? args.question : '',
            ...(typeof args.context === 'string' ? { context: args.context } : {}),
        };
        const userId = this.principalFor(profile.id, chain).userId ?? approved.requestedBy;
        const audit = { startedAt, agentId: profile.id, chain, ...(userId !== undefined ? { userId } : {}), tool: ASK_AGENT_TOOL.name, rawArgs: delegationArgs(call) };
        const verdict = call.agentId && call.question
            ? await this.authorizeDelegation(profile, call, chain, approved)
            : { ok: false as const, message: 'Delegation refused: the stored request has no agent_id or question', decision: 'deny' as const, reason: 'malformed delegation request' };
        if (!verdict.ok) {
            await this.recordAudit({ ...audit, decision: verdict.decision, reason: verdict.reason });
            return verdict.message;
        }
        const result = await this.bus.runSingle({ ...call, fromAgentId: profile.id, chain });
        await this.recordAudit({
            ...audit, decision: 'allow', ...(verdict.approval ? { approval: verdict.approval } : {}),
            ...(result.error ? { reason: result.error } : {}), outcome: result.error ? 'error' : 'ok',
        });
        return result.error ? `Error: ${result.error}` : result.content;
    }

    /**
     * Puts one question to an agent outside the conversation and returns its answer (its tool calls are governed
     * like any other). Used by `agentApprover` to let a supervising agent approve or reject requests.
     */
    async consultAgent(agentId: string, question: string): Promise<string> {
        await this.ensureAgentsLoaded();
        const result = await this.runAgentInternal(agentId, question, undefined, 0, undefined, [agentId]);
        return result.content;
    }

    abort(): void {
        this.aborted = true;
        this.runController?.abort('aborted');
        void this.opts.jobs?.cancelAll();
        this.abortController?.abort();
        this.abortController = null;
        for (const controller of [...this.subAgentControllers]) controller.abort('aborted');
        // Tools already running get their signal too; each one winds down (or is given up on after
        // the grace period) and the model is told the call was aborted.
        for (const controller of [...this.toolControllers]) controller.abort('aborted');
    }

    /** Change the iteration mode at runtime — takes effect on the next run(). */
    setIterationMode(mode: IterationMode): void {
        this.iterationManager.setMode(mode);
    }

    /** Returns the current iteration mode. */
    getIterationMode(): IterationMode {
        return this.iterationManager.mode;
    }

    /** Delete persisted history file and reset in-memory conversation. */
    clearHistory(): void {
        this.history.clear();
    }

    private saveHistory(): void {
        this.history.save();
    }

    /**
     * Runs the guardrails of `phase` over `content`, reports what happened (transport event + audit log)
     * and returns the outcome. `replacement` lets output checks attach the corrected text to the event.
     */
    private async guard(
        phase: GuardrailPhase,
        content: string,
        agentId: string,
        toolName?: string,
        replacement?: (outcome: GuardrailOutcome) => string | undefined,
    ): Promise<GuardrailOutcome> {
        if (!this.guardrails?.has(phase)) return { content, changed: false, events: [] };
        const sessionId = this.opts.sessionId ?? 'default';
        const resolved = await Promise.all(this.opts.agents.getAll().map(async a => [a.id, await resolveSecrets(a, this.opts.secretResolver)] as const));
        const secrets = resolved.find(([id]) => id === agentId)?.[1];
        const secretValues = resolved.flatMap(([, r]) => Object.values(r));
        const outcome = await this.guardrails.run({
            phase, agentId, sessionId, content,
            ...(toolName ? { toolName } : {}),
            ...(secrets && Object.keys(secrets).length ? { secrets } : {}),
            secretValues,
        });
        const replaced = replacement?.(outcome);
        outcome.events.forEach((info, i) => {
            this.transport.emit({
                type: 'guardrail',
                name: info.name, phase: info.phase, action: info.action, reason: info.reason,
                agent_id: info.agentId,
                ...(info.tool ? { tool: info.tool } : {}),
                ...(info.dryRun ? { dry_run: true } : {}),
                ...(replaced !== undefined && !info.dryRun && i === outcome.events.length - 1 ? { replacement: replaced } : {}),
            });
            void this.auditLogger.log({
                agentId: info.agentId,
                tool: `guardrail:${info.phase}:${info.name}`,
                inputPreview: `${info.action}${info.dryRun ? ' (dry-run)' : ''}: ${info.reason}`,
                success: info.action === 'redact',
                durationMs: 0,
                sessionId,
            });
        });
        return outcome;
    }

    /** Checks a model answer. Returns the (possibly corrected) message and the text to show. */
    private async guardOutput(
        message: LLMMessage,
        agentId: string,
    ): Promise<{ message: LLMMessage; text: string; touched: boolean }> {
        const original = message.content ?? '';
        if (!original || !this.guardrails?.has('output')) return { message, text: original, touched: false };
        const buffered = this.opts.guardrailOutputMode === 'buffer';
        const outcome = await this.guard('output', original, agentId, undefined, buffered ? undefined : (o) =>
            o.blocked ? this.blockedText(o) : (o.changed ? o.content : undefined));
        if (outcome.blocked) {
            const text = this.blockedText(outcome);
            return { message: { ...message, content: text }, text, touched: true };
        }
        if (outcome.changed) return { message: { ...message, content: outcome.content }, text: outcome.content, touched: true };
        return { message, text: original, touched: false };
    }

    private blockedText(outcome: GuardrailOutcome): string {
        return `[Response withheld by guardrail "${outcome.blocked?.guardrail}": ${outcome.blocked?.reason}]`;
    }

    /** Token-aware compaction first (when configured), then the message-count cap. */
    private async prepareContext(): Promise<void> {
        if (this.contextManager) {
            try {
                const report = await this.contextManager.compact();
                if (report && report.summarizedMessages + report.droppedMessages + report.truncatedToolResults > 0) {
                    this.transport.emit({
                        type: 'system', level: 'info',
                        text: `[Context] ~${report.tokensBefore} → ~${report.tokensAfter} tokens ` +
                              `(truncated ${report.truncatedToolResults} tool results, summarized ${report.summarizedMessages}, dropped ${report.droppedMessages} messages)`,
                    });
                }
            } catch (err) {
                // Compaction is best-effort: a bug here must never stop the agent.
                this.transport.emit({ type: 'system', level: 'warn', text: `[Context] Compaction failed: ${err instanceof Error ? err.message : String(err)}` });
            }
        }
        this.trimHistory();
    }

    /** Tells the model about background jobs that ended since the last iteration, once each. */
    private announceFinishedJobs(agentId: string): void {
        const finished = this.opts.jobs?.drainFinished(agentId) ?? [];
        for (const job of finished) {
            this.history.push({
                role: 'user',
                content: `[Background job ${job.id} finished (${job.status}). Use job_output to read it.]`,
            });
        }
    }

    /**
     * The provider said the request did not fit: shrink the budget and force a compaction.
     * True when the history got smaller, so repeating the call can succeed.
     */
    private async recoverFromOverflow(): Promise<boolean> {
        const cm = this.contextManager;
        if (!cm) return false;
        cm.noteOverflow();
        let report;
        try {
            report = await cm.compact({ force: true, targetRatio: 0.5 });
        } catch {
            return false;
        }
        if (!report || report.tokensAfter >= report.tokensBefore) return false;
        this.transport.emit({
            type: 'system', level: 'info',
            text: `[Context] Provider reported context overflow: compacted ~${report.tokensBefore} → ~${report.tokensAfter} tokens, ` +
                  `budget now ~${cm.effectiveMaxTokens} tokens. Retrying.`,
        });
        return true;
    }

    /** One summarization call, billed through `metrics` events like any other LLM call. */
    private summarizeForContext(transcript: string, previousSummary?: string): Promise<string> {
        const cfg = this.opts.context?.summarizer;
        const provider = this.opts.providers.resolve(cfg?.provider, this.opts.defaultProvider);
        const startedAt = Date.now();
        return new Promise<string>((resolve, reject) => {
            const chunks: string[] = [];
            Promise.resolve(provider.chat(
                [
                    { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
                    { role: 'user', content: buildSummaryPrompt(transcript, previousSummary) },
                ],
                [],
                {
                    onChunk: (delta) => { chunks.push(delta); },
                    onDone: (msg) => resolve(msg.content ?? chunks.join('')),
                    onError: reject,
                    onMetrics: (inputTokens, outputTokens, usage) => {
                        this.transport.emit(metricsEvent(inputTokens, outputTokens, usage, {
                            provider: cfg?.provider ?? this.opts.defaultProvider,
                            model: cfg?.model ?? provider.modelId, purpose: 'context_summary', startedAt,
                        }));
                    },
                    ...(cfg?.model ? { model: cfg.model } : {}),
                },
            )).catch(reject);
        });
    }

    private trimHistory(): void {
        // Unset: cap at the default, unless token-aware `context` is configured (it replaces the count cap).
        // 0 turns the cap off explicitly.
        const max = this.opts.maxContextMessages ?? (this.opts.context ? undefined : DEFAULT_MAX_CONTEXT_MESSAGES);
        if (!max) return;
        const dropped = this.history.trim(max);
        if (dropped > 0) {
            this.transport.emit({
                type: 'system',
                level: 'warn',
                text: `[ContextWindow] Dropped ${dropped} messages — history capped at ${max} (maxContextMessages)`,
            });
        }
    }

    private async ensureAgentsLoaded(): Promise<void> {
        if (this.agentsLoaded || !this.opts.loadAgents) return;
        // Cache the promise so concurrent run() calls wait for the same load,
        // rather than the early-flag pattern that let callers proceed unguarded.
        if (this.agentsLoadedPromise) return this.agentsLoadedPromise;
        this.agentsLoadedPromise = this._loadAgentsOnce();
        return this.agentsLoadedPromise;
    }

    private async _loadAgentsOnce(): Promise<void> {
        try {
            const discovered = await this.opts.loadAgents!();
            for (const agent of discovered) this.opts.agents.upsert(agent);
            if (!this.opts.agents.has(this.currentAgentId)) {
                const all = this.opts.agents.getAll();
                if (all.length > 0) this.currentAgentId = all[0].id;
            }
        } catch (err) {
            this.transport.emit({
                type: 'system', level: 'warn',
                text: `[AgentDiscovery] Failed to load agents: ${(err as Error).message}`,
            });
        } finally {
            this.agentsLoaded = true;
        }
    }

    switchAgent(agentId: string): void {
        if (!this.opts.agents.has(agentId)) throw new Error(`Agent "${agentId}" not found`);
        this.currentAgentId = agentId;
    }

    private getCurrentProfile(): AgentProfile | undefined {
        return this.opts.agents.get(this.currentAgentId);
    }

    private buildAgentRoster(profile: AgentProfile): string {
        const targets = new Set(this.delegationTargets(profile));
        const all = this.opts.agents.getAll().filter(a => targets.has(a.id));
        const mcp   = all.filter(a => a.source === 'mcp');
        const local = all.filter(a => a.source !== 'mcp');

        const parts: string[] = [];

        if (mcp.length > 0) {
            parts.push('## External Agents [MCP] — CHECK FIRST. If the task matches any of these, you MUST delegate to them via ask_agent before considering local agents.');
            for (const a of mcp) {
                parts.push(`- ${a.id} (${a.icon}): ${a.description} [MCP]`);
            }
        }

        parts.push('## Local Agents — use only when no [MCP] agent covers the task.');
        for (const a of local) {
            const tag = a.source === 'project' ? ' [PROJECT]' : a.source === 'global' ? ' [GLOBAL]' : '';
            parts.push(`- ${a.id} (${a.icon}): ${a.description}${tag}`);
        }

        return parts.join('\n');
    }

    /** Opt-in (`emitSystemPrompt`): a system prompt can carry secrets and reaches every transport. */
    private emitSystemPrompt(agentId: string, text: string): void {
        if (this.opts.emitSystemPrompt) this.transport.emit({ type: 'system_prompt', agent_id: agentId, text });
    }

    private buildSystemPrompt(profile: AgentProfile, hookSections: string[] = []): string {
        const isOrchestrator = profile.id === this.opts.defaultAgentId;
        const parts: string[] = [profile.systemPrompt];
        if (isOrchestrator) parts.push(this.buildAgentRoster(profile));
        if (this.opts.workingDir) {
            parts.push(
                `## Working Directory\n` +
                `\`${this.opts.workingDir}\``
            );
        }
        if (this.opts.projectContext) parts.push(this.opts.projectContext);
        if (this.memoryContextBlock) parts.push(this.memoryContextBlock);
        if (this.activeSkillAddition) parts.push(this.activeSkillAddition);
        parts.push(...hookSections);
        return parts.join('\n\n');
    }

    /**
     * The agents `profile` may delegate to with `ask_agent`, never itself. A non-empty `delegatesTo` is the list (`['*']`: every
     * other agent). Without one, the default agent may delegate to every other agent, as it always could, and any other agent to none.
     * An agent an MCP server registered (mode 'agent') is always a target of a list: configuring that server declared it.
     */
    private delegationTargets(profile: AgentProfile): string[] {
        const all = this.opts.agents.getAll().filter(a => a.id !== profile.id);
        const others = all.map(a => a.id);
        const declared = profile.delegatesTo ?? [];
        if (declared.length === 0) return profile.id === this.opts.defaultAgentId ? others : [];
        if (declared[0] === '*') return others;
        const mcp = all.filter(a => a.source === 'mcp').map(a => a.id);
        return [...new Set([...(declared as string[]), ...mcp])].filter(id => id !== profile.id);
    }

    /**
     * Whether `profile` may delegate `call` now: not to itself, only to its `delegationTargets`, and, in the policy path, with an
     * identity and the policies' consent, like any tool call. When it may not, it says why, for the caller to report and audit.
     * The one check for every delegation: the model's `ask_agent`, a tool's `ctx.askAgent` and `runApproved` (with the stored `approved`).
     */
    private async authorizeDelegation(
        profile: AgentProfile, call: { agentId: string; question: string; context?: string }, chain: string[], approved?: ToolCall['approved'],
    ): Promise<
        | { ok: true; approval?: { id: string; by: ApproverRef; authority?: ApproverAuthority; reason?: string } }
        | { ok: false; message: string; decision: AuditDecision; reason: string }
    > {
        if (call.agentId === profile.id) {
            return { ok: false, message: `Self-delegation blocked: agent "${profile.id}" cannot delegate to itself. Execute the task directly.`, decision: 'not_allowed', reason: 'self-delegation' };
        }
        // `delegatesTo` is a limit, not a hint: a delegation outside it never reaches the policies or the bus.
        const targets = this.delegationTargets(profile);
        if (!targets.includes(call.agentId)) {
            return {
                ok: false,
                message: targets.length > 0
                    ? `Delegation refused: agent "${profile.id}" may not delegate to "${call.agentId}". It may delegate to: ${targets.join(', ')}.`
                    : `Delegation refused: agent "${profile.id}" may not delegate to any agent. Execute the task directly.`,
                decision: 'not_allowed',
                reason: `"${call.agentId}" is not in the delegatesTo of agent "${profile.id}"`,
            };
        }
        // No identity, or no one to act for, and nobody is delegated to (SPEC-0044), with or without policies: as for any tool call.
        let base = this.principalFor(profile.id, chain);
        // Run from a stored approval, it acts for whoever asked, as the stored request recorded (SPEC-0041 F2), like a tool call does.
        if (base.userId === undefined && approved?.requestedBy !== undefined) base = { ...base, userId: approved.requestedBy };
        const who = await this.identities.check(profile.id, { sessionId: base.sessionId, ...(base.tenantId !== undefined ? { tenantId: base.tenantId } : {}), ...(base.userId !== undefined ? { userId: base.userId } : {}) });
        if (!who.ok) return { ok: false, message: `Tool call "ask_agent" denied: ${who.reason}`, decision: 'deny', reason: who.reason };
        if (!this.governed) return { ok: true };
        // In the policy path a delegation is a call like any other: the policies may deny it or ask first.
        const verdict = await this.gate.decide(ASK_AGENT_TOOL, JSON.stringify(delegationArgs(call)), who.identity ? { ...base, agentIdentity: who.identity } : base, [], approved);
        return verdict.run
            ? { ok: true, ...(verdict.approval ? { approval: verdict.approval } : {}) }
            : { ok: false, message: verdict.message, decision: verdict.decision, reason: verdict.reason };
    }

    /** Whether `profile` is offered `ask_agent`: only the default agent, and only with someone registered to delegate to. */
    private offersAskAgent(profile: AgentProfile): boolean {
        return profile.id === this.opts.defaultAgentId && this.delegationTargets(profile).some(id => this.opts.agents.has(id));
    }

    private getToolsForAgent(profile: AgentProfile): ToolDefinition[] {
        const allowed = this.opts.tools.getForAgent(profile.allowedTools);
        const hasDeferred = allowed.some(t => isDeferred(t, profile));
        const found = this.discovered.get(profile.id) ?? [];
        // Deferred tools stay out until found. Without any, the list is exactly what it always was.
        const tools = hasDeferred ? allowed.filter(t => !isDeferred(t, profile)) : allowed;
        // ask_agent solo tiene sentido si el agente por defecto tiene a quien
        // delegar. En un engine de un solo agente, profile.id === defaultAgentId
        // es trivialmente cierto y antes se le ofrecia la tool igual, sin ningun
        // target valido en el roster — si el modelo la llamaba, el turno completo
        // se perdia sin texto visible y sin error (ver bug del pulso de mercado,
        // agente_bk, 2026-07-24).
        if (this.offersAskAgent(profile)) tools.push(ASK_AGENT_TOOL);
        if (hasDeferred) {
            // The list only grows, at the end: what the provider has cached of the prefix stays valid up to there (D4).
            // In 'message' mode it does not grow: what was found is described in the answer of tool_search.
            tools.push(this.toolSearchTool(profile));
            for (const name of this.opts.toolSearch?.mode === 'message' ? [] : found) {
                const t = allowed.find(a => a.name === name);
                if (t) tools.push(t);
            }
        }
        return tools;
    }

    private agentHasDeferred(profile: AgentProfile): boolean {
        return this.opts.tools.getForAgent(profile.allowedTools).some(t => isDeferred(t, profile));
    }

    /** `tool_search` for one agent: it looks only among the deferred tools the agent may call, and makes what it returns visible. */
    private toolSearchTool(profile: AgentProfile): ToolDefinition {
        return toolSearchDefinition(async (args) => {
            const query = typeof (args as { query?: unknown })?.query === 'string' ? (args as { query: string }).query : '';
            const principal = this.principalFor(profile.id);
            const candidates: ToolDefinition[] = [];
            for (const t of this.opts.tools.getForAgent(profile.allowedTools)) {
                if (!isDeferred(t, profile)) continue;
                // A tool the sandbox refuses outright, or a policy denies, is not offered: the model would only be told it exists.
                const verdict = this.opts.sandbox?.authorizeTool?.({ agentId: profile.id, sessionId: this.opts.sessionId ?? 'default' }, t.name);
                if (verdict && !verdict.ok) continue;
                if (this.governed && (await evaluatePolicies(this.policies, principal, { tool: t, args: {} })).effect === 'deny') continue;
                candidates.push(t);
            }
            const max = Math.max(1, this.opts.toolSearch?.maxResults ?? TOOL_SEARCH_DEFAULT_RESULTS);
            const custom = this.opts.toolSearch?.search;
            // A search of the user's own can only return candidates: the rest was hidden by governance, and finding never authorizes.
            const found = custom
                ? [...new Set(await custom(query, candidates))].filter(t => candidates.includes(t)).slice(0, max)
                : rankTools(query, candidates, max);
            const known = this.discovered.get(profile.id) ?? [];
            this.discovered.set(profile.id, [...known, ...found.map(t => t.name).filter(n => !known.includes(n))]);
            return describeFound(found, this.opts.toolSearch?.mode === 'message');
        });
    }

    /**
     * Merges the orchestrator's current-turn analysis with the explicit context the
     * LLM provided in the ask_agent call. The analysis (streamBuffer) gives specialists
     * the reasoning and data the orchestrator gathered before delegating.
     */
    private buildSubAgentContext(explicit: string | undefined, orchestratorAnalysis: string): string | undefined {
        const trimmed = orchestratorAnalysis.trim();
        if (!explicit && !trimmed) return undefined;
        const parts: string[] = [];
        if (explicit) parts.push(explicit);
        if (trimmed) parts.push(`## Orchestrator Analysis\n${trimmed}`);
        return parts.join('\n\n');
    }

    private async runLoop(profile: AgentProfile): Promise<void> {
        let currentProfile = profile;

        this.iterationManager.reset();
        const iterManager = this.iterationManager;
        let overflowRetries = 0;
        let hookContinues = 0;

        this.transport.emit({
            type: 'block_start',
            agent_id: profile.id,
            agent_name: profile.name,
            agent_icon: profile.icon,
        });

        while (!this.aborted) {
            if (this.opts.abortOnBudget && this.opts.observabilityManager?.isRunOverBudget()) break;
            const shouldContinue = await iterManager.advance();
            if (!shouldContinue) break;

            this.announceFinishedJobs(currentProfile.id);
            await this.prepareContext();

            const systemMsg: LLMMessage = {
                role: 'system',
                content: this.buildSystemPrompt(currentProfile, await this.hookPromptSections(currentProfile)),
            };
            this.emitSystemPrompt(currentProfile.id, systemMsg.content ?? '');
            const tools = this.getToolsForAgent(currentProfile);
            const safeHistory = this.history.sanitized();
            if (this.contextManager) {
                this.lastRequestEstimate =
                    this.contextManager.estimateText(systemMsg.content ?? '') +
                    this.contextManager.estimateText(JSON.stringify(tools.map(t => [t.name, t.description, t.parameters]))) +
                    this.contextManager.estimateRaw(safeHistory);
            }

            let streamBuffer = '';
            // `buffer` mode: hold tokens until the output guardrails have seen the whole answer.
            const holdOutput = !!this.guardrails?.has('output') && this.opts.guardrailOutputMode === 'buffer';
            const heldTokens: string[] = [];
            const askAgentCalls: Array<{ id: string; agentId: string; question: string; context?: string }> = [];
            const otherCalls: Array<{ id: string; name: string; args: string }> = [];
            let finalMessage: LLMMessage | null = null;
            let overflowError: Error | null = null;

            this.abortController = new AbortController();
            const signal = this.abortController.signal;

            const chatProvider = this.getProviderForProfile(currentProfile);
            const llmStartedAt = Date.now();
            await chatProvider.chat(
                [systemMsg, ...safeHistory],
                tools,
                {
                    onChunk: (delta) => {
                        streamBuffer += delta;
                        if (holdOutput) heldTokens.push(delta);
                        else this.transport.emit({ type: 'token', content: delta, agent_id: currentProfile.id });
                    },
                    onToolCall: (name, args, id) => {
                        this.transport.emit({ type: 'tool_call', name, args_preview: args.slice(0, 200) });
                        if (name === 'ask_agent') {
                            try {
                                const parsed = JSON.parse(args);
                                askAgentCalls.push({ id, agentId: parsed.agent_id, question: parsed.question, context: parsed.context });
                            } catch {
                                otherCalls.push({ id, name, args });
                            }
                        } else {
                            otherCalls.push({ id, name, args });
                        }
                    },
                    onDone: (msg) => { finalMessage = msg; },
                    onError: (err) => {
                        if (this.aborted) return;
                        // Held back: the loop below may recover by compacting and retrying.
                        if (this.contextManager && this.opts.context?.overflowRetry !== false && isContextOverflowError(err)) {
                            overflowError = err;
                            return;
                        }
                        this.transport.emit({ type: 'error', message: err.message });
                    },
                    onMetrics: (inputTokens, outputTokens, usage) => {
                        // Anthropic reports cached tokens apart from input_tokens; the request still carried them.
                        this.contextManager?.observeUsage(
                            inputTokens + (usage?.cacheReadTokens ?? 0) + (usage?.cacheWriteTokens ?? 0),
                            this.lastRequestEstimate,
                        );
                        this.transport.emit(metricsEvent(inputTokens, outputTokens, usage, {
                            agentId: currentProfile.id,
                            provider: currentProfile.provider ?? this.opts.defaultProvider,
                            model: currentProfile.model ?? chatProvider.modelId,
                            startedAt: llmStartedAt,
                        }));
                    },
                    signal,
                    model: currentProfile.model,
                }
            );

            this.abortController = null;
            if (this.aborted) break;

            if (!finalMessage && overflowError) {
                if (overflowRetries < MAX_OVERFLOW_RETRIES && await this.recoverFromOverflow()) {
                    overflowRetries++;
                    continue;
                }
                this.transport.emit({ type: 'error', message: (overflowError as Error).message });
                break;
            }

            if (!finalMessage) break;

            const guardedOut = await this.guardOutput(finalMessage as LLMMessage, currentProfile.id);
            finalMessage = guardedOut.message;
            if (guardedOut.touched) streamBuffer = guardedOut.text;
            if (holdOutput) {
                const shown = guardedOut.touched ? guardedOut.text : heldTokens.join('');
                if (shown) this.transport.emit({ type: 'token', content: shown, agent_id: currentProfile.id });
            }

            this.history.push(finalMessage);

            const toolResults: LLMMessage[] = [];

            // ── ask_agent: parallel if 2+ calls ──────────────────────────────
            if (askAgentCalls.length > 0) {
                // Delegations are audited like any tool call: one event each (SPEC-0014 F1).
                const callerChain = this.principalFor(currentProfile.id).chain;
                const validCalls: typeof askAgentCalls = [];
                // Who approved each delegation that asked first: its audit event says so, as for any approved tool call.
                const approvals = new Map<string, { id: string; by: ApproverRef; authority?: ApproverAuthority; reason?: string }>();
                for (const call of askAgentCalls) {
                    const startedAt = Date.now();
                    const refused = await this.authorizeDelegation(currentProfile, call, callerChain);
                    if (refused.ok) {
                        validCalls.push(call);
                        if (refused.approval) approvals.set(call.id, refused.approval);
                        continue;
                    }
                    this.transport.emit({ type: 'tool_result', name: 'ask_agent', agent_id: currentProfile.id, success: false, preview: refused.message.slice(0, 120) });
                    toolResults.push({ role: 'tool', tool_call_id: call.id, content: refused.message });
                    await this.recordAudit({
                        startedAt, agentId: currentProfile.id, chain: callerChain, tool: 'ask_agent',
                        rawArgs: delegationArgs(call), decision: refused.decision, reason: refused.reason,
                    });
                }

                if (validCalls.length > 0) {
                    const startedAt = Date.now();
                    const requests = validCalls.map(c => ({
                        agentId:     c.agentId,
                        question:    c.question,
                        context:     this.buildSubAgentContext(c.context, streamBuffer),
                        fromAgentId: currentProfile.id,
                        chain:       callerChain,
                    }));

                    const results = validCalls.length >= 2
                        ? await this.bus.runParallel(requests)
                        : [await this.bus.runSingle(requests[0])];

                    for (let i = 0; i < validCalls.length; i++) {
                        const call = validCalls[i];
                        const result = results[i];
                        const content = result.error ? `Error: ${result.error}` : result.content;
                        this.transport.emit({ type: 'tool_result', name: 'ask_agent', agent_id: currentProfile.id, success: !result.error, preview: content.slice(0, 120) });
                        toolResults.push({ role: 'tool', tool_call_id: call.id, content });
                        await this.recordAudit({
                            startedAt, agentId: currentProfile.id, chain: callerChain, tool: 'ask_agent', rawArgs: delegationArgs(call),
                            decision: 'allow', ...(approvals.has(call.id) ? { approval: approvals.get(call.id) } : {}),
                            ...(result.error ? { reason: result.error } : {}),
                            outcome: result.error ? 'error' : 'ok',
                        });
                    }
                }
            }

            // ── other tools: sequential ───────────────────────────────────────
            const maxParallel = Math.max(1, this.opts.maxParallelTools ?? 1);
            let idx = 0;
            while (idx < otherCalls.length) {
                if (this.aborted) break;
                const first = otherCalls[idx];
                const wave = [first];
                idx++;
                if (maxParallel > 1 && this.opts.tools.get(first.name)?.concurrencySafe) {
                    while (
                        idx < otherCalls.length &&
                        wave.length < maxParallel &&
                        this.opts.tools.get(otherCalls[idx].name)?.concurrencySafe
                    ) wave.push(otherCalls[idx++]);
                }
                for (let i = 0; i < wave.length; i++) iterManager.recordToolCall();
                if (wave.length === 1) {
                    const result = await this.executeToolCall(first, currentProfile, 0, undefined, () => this.history.redactToolCallArgs(first.id));
                    toolResults.push({ role: 'tool', tool_call_id: first.id, content: result });
                    continue;
                }
                // Parallel wave: events buffered per call, flushed in call order.
                const buffers: Array<Array<import('../types').AgentEvent>> = wave.map(() => []);
                const results = await Promise.all(wave.map((call, i) =>
                    this.executeToolCall(call, currentProfile, 0, e => buffers[i].push(e), () => this.history.redactToolCallArgs(call.id)),
                ));
                wave.forEach((call, i) => {
                    for (const e of buffers[i]) this.transport.emit(e);
                    toolResults.push({ role: 'tool', tool_call_id: call.id, content: results[i] });
                });
            }

            if (toolResults.length === 0) {
                // The model answered without tools: afterTurn hooks may force another pass (SPEC-0014 F3).
                this.lastAnswer = streamBuffer;
                const next = await this.afterTurnHooks(currentProfile, streamBuffer);
                if (!next) break;
                const cap = this.opts.maxHookContinues ?? DEFAULT_MAX_HOOK_CONTINUES;
                if (hookContinues >= cap) {
                    this.transport.emit({ type: 'system', level: 'warn', text: `[hooks] afterTurn asked for more than ${cap} extra passes; stopping` });
                    break;
                }
                hookContinues++;
                if (next.agentId) {
                    const nextProfile = this.opts.agents.get(next.agentId);
                    if (!nextProfile) throw new Error(`afterTurn hook asked to continue as unknown agent "${next.agentId}"`);
                    currentProfile = nextProfile;
                }
                if (next.message) this.history.push({ role: 'user', content: next.message });
                continue;
            }
            this.history.pushAll(toolResults);
        }

        this.transport.emit({ type: 'block_end', status: 'ok', agent_id: profile.id });
    }

    private async runAgentInternal(agentId: string, question: string, context?: string, depth = 0, outputBuffer?: import('../types').AgentEvent[], chain?: string[]): Promise<{ agentId: string; content: string; inputTokens: number; outputTokens: number; elapsedMs: number }> {
        const profile = this.opts.agents.get(agentId);
        if (!profile) throw new Error(`Agent "${agentId}" not registered`);
        // Delegation chain of this sub-agent, oldest first (SPEC-0014 principal).
        const agentChain = chain && chain.length > 0 ? chain : [agentId];

        const start = Date.now();

        // Inject recent history from the orchestrator's conversation so specialists
        // can see previously gathered data (file reads, command outputs, etc.)
        // without requiring the orchestrator to manually copy it into context.
        let historySlice: LLMMessage[] = [];
        const maxCtxMsgs = this.opts.subAgentContextMessages;
        const allMessages = this.history.getAll();
        if (maxCtxMsgs && maxCtxMsgs > 0 && allMessages.length > 0) {
            historySlice = allMessages.slice(-maxCtxMsgs);
            // Trim to the first user-turn boundary to avoid orphaning tool results.
            const firstUser = historySlice.findIndex(m => m.role === 'user');
            if (firstUser > 0) historySlice = historySlice.slice(firstUser);
            else if (firstUser < 0) historySlice = [];
            historySlice = sanitizeMessages(historySlice);
        }

        const systemText = this.buildSystemPrompt(profile, await this.hookPromptSections(profile));
        this.emitSystemPrompt(profile.id, systemText);
        const messages: LLMMessage[] = [
            { role: 'system', content: systemText },
            ...historySlice,
            { role: 'user', content: context ? `${question}\n\nContext:\n${context}` : question },
        ];

        let finalContent = '';
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        const maxIter = this.opts.maxIterations ?? 100;
        let iter = 0;

        // When running in parallel (outputBuffer provided), route output events to the
        // buffer instead of the real transport. The caller flushes the buffer atomically
        // after the agent finishes, preventing interleaved output from parallel agents.
        // tool_approval_request always bypasses buffering — it needs an immediate response.
        const emit = (event: import('../types').AgentEvent): void => {
            if (outputBuffer) outputBuffer.push(event);
            else this.transport.emit(event);
        };

        emit({ type: 'block_start', agent_id: profile.id, agent_name: profile.name, agent_icon: profile.icon });

        // A sub-agent runs on a local message list that nothing used to bound or recover: a long tool loop
        // grew it until the provider rejected the request. With `context` configured it gets the same
        // token-aware compaction as the main loop, run over a throwaway HistoryManager that mirrors the list
        // (the system message at index 0 is never compacted). Calibration and overflow learning live per run.
        const subHistory = this.opts.context ? new HistoryManager({}) : undefined;
        const subContext = this.opts.context && subHistory
            ? new ContextManager(this.opts.context, {
                history: subHistory,
                summarize: (transcript, previous) => this.summarizeForContext(transcript, previous),
                emit,
            })
            : undefined;
        const compactMessages = async (opts: { force?: boolean } = {}): Promise<void> => {
            if (!subContext || !subHistory) return;
            subHistory.replaceAll(messages.slice(1));
            const report = await subContext.compact(opts);
            if (report) messages.splice(1, messages.length - 1, ...subHistory.getAll());
        };

        while (iter < maxIter && !this.aborted) {
            iter++;
            await compactMessages();

            let streamContent = '';
            const holdOutput = !!this.guardrails?.has('output') && this.opts.guardrailOutputMode === 'buffer';
            const heldTokens: string[] = [];
            const toolCalls: Array<{ id: string; name: string; args: string }> = [];
            let finalMessage: LLMMessage | null = null;

            const chatProvider = this.getProviderForProfile(profile);
            const llmStartedAt = Date.now();
            for (let attempt = 0; ; attempt++) {
                const subController = new AbortController();
                this.subAgentControllers.add(subController);
                try {
                    await chatProvider.chat(messages, this.getToolsForAgent(profile), {
                        onChunk: (delta) => {
                            streamContent += delta;
                            if (holdOutput) heldTokens.push(delta);
                            else if (!profile.suppressDefaultOutput) {
                                emit({ type: 'token', content: delta, agent_id: profile.id });
                            }
                        },
                        onToolCall: (name, args, id) => {
                            if (!profile.suppressDefaultOutput) {
                                emit({ type: 'tool_call', name, args_preview: args.slice(0, 200) });
                            }
                            toolCalls.push({ id, name, args });
                        },
                        onDone: (msg) => { finalMessage = msg; },
                        onError: (err) => { throw err; },
                        onMetrics: (inputTokens, outputTokens, usage) => {
                            totalInputTokens += inputTokens;
                            totalOutputTokens += outputTokens;
                            emit(metricsEvent(inputTokens, outputTokens, usage, {
                                agentId: profile.id,
                                provider: profile.provider ?? this.opts.defaultProvider,
                                model: profile.model ?? chatProvider.modelId,
                                startedAt: llmStartedAt,
                            }));
                        },
                        signal: subController.signal,
                        model: profile.model,
                    });
                    break;
                } catch (err) {
                    // The provider said the request was too large: trust the budget less, compact hard, once.
                    if (attempt === 0 && subContext && !this.aborted && this.opts.context?.overflowRetry !== false && isContextOverflowError(err)) {
                        subContext.noteOverflow();
                        streamContent = ''; heldTokens.length = 0; toolCalls.length = 0; finalMessage = null;
                        await compactMessages({ force: true });
                        continue;
                    }
                    throw err;
                } finally {
                    this.subAgentControllers.delete(subController);
                }
            }

            if (this.aborted || !finalMessage) break;
            const guardedOut = await this.guardOutput(finalMessage as LLMMessage, profile.id);
            finalMessage = guardedOut.message;
            if (guardedOut.touched) streamContent = guardedOut.text;
            if (holdOutput && !profile.suppressDefaultOutput) {
                const shown = guardedOut.touched ? guardedOut.text : heldTokens.join('');
                if (shown) emit({ type: 'token', content: shown, agent_id: profile.id });
            }
            if (streamContent) finalContent = streamContent;
            messages.push(finalMessage);

            if (toolCalls.length === 0) break;

            const toolResults: LLMMessage[] = [];
            for (const call of toolCalls) {
                // abort() reaches the calls already running, not the ones still to start: those must not start.
                if (this.aborted) break;
                const result = await this.executeToolCall(call, profile, depth, emit, () => {
                    // Sub-agent history is the local `messages` array: blank the refused arguments there too.
                    for (const m of messages) {
                        const tc = m.role === 'assistant' ? m.tool_calls?.find(c => c.id === call.id) : undefined;
                        if (tc) tc.function = { ...tc.function, arguments: '{"redacted":"blocked by guardrail"}' };
                    }
                }, agentChain);
                toolResults.push({ role: 'tool', tool_call_id: call.id, content: result });
            }
            messages.push(...toolResults);
        }

        emit({ type: 'block_end', status: 'ok', agent_id: profile.id });

        return { agentId, content: finalContent, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, elapsedMs: Date.now() - start };

    }

    /** The sandbox this engine runs tools through, if any (e.g. to read or change its policy at runtime). */
    get sandbox(): import('../sandbox/types').SandboxRunner | undefined { return this.opts.sandbox; }

    /**
     * The runner a tool sees: the real one (so `policy` and the rest stay reachable) with `run` wrapped so each
     * outcome is reported on THIS engine's transport and audit log. A runner shared by several engines therefore
     * never leaks one engine's decisions to another.
     */
    private sandboxFor(agentId: string, collect?: AuditSandboxDecision[]): import('../sandbox/types').SandboxRunner {
        const real = this.opts.sandbox!;
        return Object.assign(Object.create(real), {
            run: async (caller: import('../sandbox/types').SandboxCaller, req: import('../sandbox/types').SandboxExecRequest) => {
                const out = await real.run(caller, req);
                this.reportSandboxDecision(out.ok
                    ? { outcome: 'allowed', tool: req.tool, agentId, mode: out.mode, network: out.network, backend: out.backend }
                    : { outcome: out.code, tool: req.tool, agentId, mode: out.mode, network: out.network, backend: out.backend, reason: out.reason },
                collect);
                return out;
            },
            ...(real.authorizePath ? {
                authorizePath: (caller: import('../sandbox/types').SandboxCaller, req: import('../sandbox/types').SandboxPathRequest) => {
                    const verdict = real.authorizePath!(caller, req);
                    // Allowed reads are not reported (every file read would be an event); denials and writes are.
                    if (!verdict.ok) this.reportSandboxDecision({ outcome: verdict.code, tool: req.tool, agentId, reason: verdict.reason }, collect);
                    else if (req.access === 'write') this.reportSandboxDecision({ outcome: 'allowed', tool: req.tool, agentId }, collect);
                    return verdict;
                },
            } : {}),
        });
    }

    /** The message for the model when the sandbox policy refuses `tool` for `agentId`; undefined when allowed. */
    private sandboxRefusal(tool: string, agentId: string, collect?: AuditSandboxDecision[]): string | undefined {
        const verdict = this.opts.sandbox?.authorizeTool?.({ agentId, sessionId: this.opts.sessionId ?? 'default' }, tool);
        if (!verdict || verdict.ok) return undefined;
        this.reportSandboxDecision({ outcome: verdict.code, tool, agentId, reason: verdict.reason }, collect);
        return `Tool call "${tool}" refused by the sandbox policy (${verdict.code}): ${verdict.reason}`;
    }

    /**
     * Reports a sandbox decision on the transport and the legacy audit log, and, when `collect` is given, adds it to
     * the decisions the single `AuditEvent` of the current tool call will carry.
     */
    private reportSandboxDecision(d: {
        outcome: 'allowed' | 'SANDBOX_DENIED' | 'SANDBOX_UNAVAILABLE'; tool: string;
        mode?: import('../sandbox/types').SandboxMode; network?: import('../sandbox/types').SandboxNetwork;
        agentId: string; backend?: string; reason?: string;
    }, collect?: AuditSandboxDecision[]): void {
        collect?.push({
            outcome: d.outcome,
            ...(d.mode ? { mode: d.mode } : {}), ...(d.network ? { network: d.network } : {}),
            ...(d.backend ? { backend: d.backend } : {}), ...(d.reason ? { reason: d.reason } : {}),
        });
        this.transport.emit({
            type: 'sandbox', outcome: d.outcome, tool: d.tool, agent_id: d.agentId,
            ...(d.mode ? { mode: d.mode } : {}), ...(d.network ? { network: d.network } : {}),
            ...(d.backend ? { backend: d.backend } : {}), ...(d.reason ? { reason: d.reason } : {}),
        });
        void this.auditLogger.log({
            agentId: d.agentId, tool: `sandbox:${d.tool}`,
            inputPreview: `${d.outcome}${d.mode ? ` ${d.mode}/${d.network ?? '?'}` : ''}${d.backend ? ` via ${d.backend}` : ''}${d.reason ? `: ${d.reason}` : ''}`,
            success: d.outcome === 'allowed', durationMs: 0, sessionId: this.opts.sessionId,
        });
    }

    /**
     * Unified tool execution used by both runLoop (primary agent) and
     * runAgentInternal (sub-agents via ask_agent).
     * Handles: allowedTools → sandbox refusal → argument guardrails → policy/approval (or the legacy gate)
     * → execute → result guardrails → audit → transport.
     */
    private async executeToolCall(
        call: { name: string; args: string },
        profile: import('../types').AgentProfile,
        depth = 0,
        emit?: (event: import('../types').AgentEvent) => void,
        /** Called when a guardrail refused the arguments, so the caller can scrub them from its history. */
        onArgsRefused?: () => void,
        /** Delegation chain of `profile`, oldest first. Default `[profile.id]`. */
        chain?: string[],
        /** Set only by `runApproved`: this exact call was approved and stored (resubmission, SPEC-0014 §6). */
        approved?: ToolCall['approved'],
    ): Promise<string> {
        const emitEvent = emit ?? ((e) => this.transport.emit(e));
        const callStart = Date.now();
        // `tool_search` exists only for an agent that has deferred tools, and needs no entry in its allowedTools.
        const isToolSearch = call.name === TOOL_SEARCH_NAME && this.agentHasDeferred(profile);
        const toolDef = isToolSearch ? this.toolSearchTool(profile) : this.opts.tools.get(call.name);
        let principal = this.principalFor(profile.id, chain);
        let result: string;
        let success: boolean;
        let outcome: 'timeout' | 'aborted' | undefined;
        let errorCode: string | undefined;
        let sandboxRefusal: string | undefined;
        // What the single audit event of this call records (SPEC-0014 F1).
        let decision: AuditDecision = 'allow';
        let reason: string | undefined;
        let ran = false;
        let approval: { id: string; by: ApproverRef; authority?: ApproverAuthority; reason?: string } | undefined;
        let credentials: AuditCredential[] | undefined;
        let mandate: AuditMandate | undefined;
        let exceeded: AuditMandate | undefined;
        const sandboxDecisions: AuditSandboxDecision[] = [];

        if (!toolDef) {
            result  = `Tool "${call.name}" not found`;
            success = false;
            decision = 'not_found';
        } else if (
            !isToolSearch &&
            !profile.allowedTools.includes(call.name) &&
            !(this.opts.allowUnlistedTools && profile.allowedTools.length === 0 && !(profile.delegatesTo && profile.delegatesTo.length > 0))
        ) {
            result  = `Tool "${call.name}" is not authorized for agent "${profile.id}". ` +
                      (this.offersAskAgent(profile)
                          ? `Use ask_agent to delegate to a specialist.`
                          : `Add it to the agent's allowedTools if it should be able to use it.`);
            success = false;
            decision = 'not_allowed';
            reason = `not in the allowedTools of agent "${profile.id}"`;
        } else if (!isToolSearch && !approved && isDeferred(toolDef, profile) && !(this.discovered.get(profile.id) ?? []).includes(call.name)) {
            // The model knows this tool only by name: it must find it first, not guess its arguments. A stored approval already did.
            result  = `Tool "${call.name}" is not loaded yet. Call tool_search to find it, then call it.`;
            success = false;
            decision = 'not_found';
            reason = 'a deferred tool was called before tool_search found it';
        } else if ((sandboxRefusal = this.sandboxRefusal(call.name, profile.id, sandboxDecisions)) !== undefined) {
            // The policy refuses this tool outright (e.g. a writer while read-only). Nobody is asked and nothing runs.
            result  = sandboxRefusal;
            success = false;
            decision = 'sandbox_denied';
            reason = sandboxDecisions[sandboxDecisions.length - 1]?.reason;
        } else {
            // Guardrails on the arguments run before approval: nobody is asked to approve a blocked call.
            let effective = call;
            let withheld: string | undefined;
            if (this.guardrails?.has('tool_call')) {
                const checked = await this.guard('tool_call', call.args, profile.id, call.name);
                if (checked.blocked) {
                    withheld = `Tool call "${call.name}" blocked by guardrail "${checked.blocked.guardrail}": ${checked.blocked.reason}`;
                } else if (checked.changed) {
                    try {
                        JSON.parse(checked.content);
                        effective = { name: call.name, args: checked.content };
                    } catch {
                        withheld = `Tool call "${call.name}" blocked by guardrails: redaction left the arguments invalid`;
                    }
                }
            }

            if (withheld) {
                result = withheld; success = false;
                decision = 'guardrail_blocked';
                reason = withheld;
                onArgsRefused?.();
            } else {
                // A worker that runs a stored approval acts for whoever asked, as the stored request recorded (SPEC-0041 F2): it needs no `identity.userId` of its own.
                if (principal.userId === undefined && approved?.requestedBy !== undefined) principal = { ...principal, userId: approved.requestedBy };
                // SPEC-0044: no identity, or no one to act for, and nothing runs (unless the operator switched it off, for tests).
                const who = await this.identities.check(profile.id, { sessionId: principal.sessionId, ...(principal.tenantId !== undefined ? { tenantId: principal.tenantId } : {}), ...(principal.userId !== undefined ? { userId: principal.userId } : {}) });
                if (who.ok && who.identity) principal = { ...principal, agentIdentity: who.identity };
                const verdict = !who.ok
                    ? { run: false as const, decision: 'deny' as const, reason: who.reason, message: `Tool call "${call.name}" denied: ${who.reason}` }
                    : this.governed
                        ? await this.gate.decide(toolDef, effective.args, principal, sandboxDecisions, approved)
                        : await this.decideLegacy(effective, profile.id, sandboxDecisions);
                if (!verdict.run) {
                    result = verdict.message; success = false;
                    decision = verdict.decision;
                    reason = verdict.reason;
                } else if (this.currentRunId !== undefined && this.aborted) {
                    // The run was aborted while the call waited (for an approver, say): an approval that arrives late does not start it.
                    // Any path of a run, the direct MCP route included; outside a run (`runApproved`) a stale abort stops nothing.
                    result = `Error: aborted: tool "${call.name}" was cancelled before it ran`; success = false;
                    outcome = 'aborted';
                    approval = verdict.approval;
                    reason = 'the run was aborted before the call started';
                } else {
                    ran = true;
                    approval = verdict.approval;
                    mandate = verdict.mandate;
                    // An approved call says why a person was asked, and which mandate it went beyond: the approval alone does not.
                    if (verdict.asked) { reason = verdict.asked.reason; exceeded = verdict.asked.exceeds; }
                    const toolHooks = this.hooks.some(h => h.beforeTool || h.afterTool);
                    const hookCall: ToolCall | undefined = toolHooks ? { tool: toolDef, args: this.parseArgs(effective.args) } : undefined;
                    const hookCtx = toolHooks ? this.toolHookContext(principal) : undefined;
                    if (hookCall && hookCtx) await runHooks(this.hooks, 'beforeTool', h => h.beforeTool!(hookCtx, hookCall));
                    // The credentials the tool declared are leased now, after the call is authorized and for this call only. A simulation
                    // (dry run) writes nothing, so it gets none. A broker that refuses, or none configured, means the tool does not run.
                    const held = toolDef.credentials?.length && verdict.mode !== 'dry_run'
                        ? await this.gate.leaseCredentials(toolDef, effective.args, principal, approval)
                        : undefined;
                    if (held && 'problem' in held) {
                        ran = false; success = false; decision = 'deny'; reason = held.problem;
                        result = `Tool call "${call.name}" refused: ${held.problem}`;
                    } else {
                        try {
                            ({ result, success, outcome, errorCode } = await this.runToolDef(
                                effective, toolDef, profile.id, depth, sandboxDecisions, principal, verdict.mode === 'dry_run', held?.values,
                                approval?.id ?? hashArgs({ run: this.currentRunId ?? null, agent: profile.id, tool: call.name, args: this.parseArgs(effective.args) }),
                            ));
                        } finally {
                            if (held) credentials = await this.gate.releaseCredentials(held);
                        }
                    }
                    if (this.guardrails?.has('tool_result')) {
                        const checked = await this.guard('tool_result', result, profile.id, call.name);
                        result = checked.blocked
                            ? `[Tool result withheld by guardrail "${checked.blocked.guardrail}": ${checked.blocked.reason}]`
                            : checked.content;
                    }
                    if (hookCall && hookCtx) {
                        const finalResult = { text: result, success };
                        await runHooks(this.hooks, 'afterTool', h => h.afterTool!(hookCtx, hookCall, finalResult));
                    }
                }
            }
            call = effective;
        }

        await this.auditLogger.log({ agentId: profile.id, tool: call.name, inputPreview: call.args, success, durationMs: Date.now() - callStart, sessionId: this.opts.sessionId });
        await this.recordAudit({
            startedAt: callStart,
            agentId: profile.id,
            chain: principal.chain,
            ...(principal.userId !== undefined ? { userId: principal.userId } : {}),
            tool: call.name,
            rawArgs: call.args,
            decision,
            reason,
            outcome: ran ? (outcome ?? (success ? 'ok' : 'error')) : outcome,
            ...(errorCode ? { errorCode } : {}),
            approval,
            ...(credentials ? { credentials } : {}),
            ...(mandate ? { mandate } : {}),
            ...(exceeded ? { exceeded } : {}),
            sandbox: sandboxDecisions,
            meta: toolDef?.meta,
        });
        // Strip ANSI before slicing to avoid partial escape sequences in the preview
        // eslint-disable-next-line no-control-regex
        const cleanPreview = result.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
        const resultEvent: import('../types').AgentEvent = {
            type: 'tool_result', name: call.name, success, preview: cleanPreview.slice(0, 120),
            agent_id: profile.id, started_at: callStart, duration_ms: Date.now() - callStart,
            ...(outcome ? { outcome } : {}),
            ...(errorCode ? { error_code: errorCode } : {}),
        };
        // The arguments go to the result of the run and nowhere else: not in the event, so no transport receives them.
        if (this.opts.recordArgs) this.recorder?.attachArgs(resultEvent, this.parseArgs(call.args));
        emitEvent(resultEvent);
        return result;
    }

    /** The legacy gate (onToolApproval + the built-in list of tools that ask), unchanged, as a verdict. */
    private async decideLegacy(
        call: { name: string; args: string }, agentId: string, sandboxDecisions: AuditSandboxDecision[],
    ): Promise<GovernedVerdict> {
        const sandboxAsk = this.opts.sandbox?.approvalFor
            ? this.opts.sandbox.approvalFor({ agentId, sessionId: this.opts.sessionId ?? 'default' }, call.name)
            : undefined;
        const gate = await this.gate.serialize(() => this.approvalGate.check(call, agentId, sandboxAsk, this.opts.tools.get(call.name)));
        if (gate === 'rejected') {
            return { run: false, decision: 'deny', reason: 'rejected by the approver', message: `Tool call "${call.name}" was rejected by the user.` };
        }
        if (gate === 'no-approver') return this.noApproverForSandbox(call.name, agentId, sandboxDecisions);
        return { run: true };
    }

    private noApproverForSandbox(tool: string, agentId: string, sandboxDecisions: AuditSandboxDecision[]): GovernedVerdict {
        const reason = `tool "${tool}" needs approval under the sandbox policy and no approver is configured`;
        this.reportSandboxDecision({ outcome: 'SANDBOX_DENIED', tool, agentId, reason }, sandboxDecisions);
        return {
            run: false, decision: 'sandbox_denied', reason,
            message: `Tool call "${tool}" refused (SANDBOX_DENIED): needs approval under the sandbox policy and no approver is configured.`,
        };
    }

    private async runToolDef(
        call: { name: string; args: string },
        toolDef: import('../types').ToolDefinition,
        agentId: string,
        depth = 0,
        sandboxDecisions?: AuditSandboxDecision[],
        principal?: Principal,
        dryRun = false,
        credentials?: Record<string, string>,
        idempotencyKey?: string,
    ): Promise<{ result: string; success: boolean; outcome?: 'timeout' | 'aborted'; errorCode?: string }> {
        const controller = new AbortController();
        this.toolControllers.add(controller);
        const secrets = await resolveSecrets(this.opts.agents.get(agentId), this.opts.secretResolver);
        const ctx = {
            ...this.buildContext(agentId, depth, principal?.chain),
            ...(dryRun ? { dryRun: true } : {}),
            ...(Object.keys(secrets).length ? { secrets } : {}),
            ...(credentials ? { credentials } : {}),
            ...(idempotencyKey ? { idempotencyKey } : {}),
            ...(this.opts.jobs ? { jobs: this.opts.jobs } : {}),
            ...(this.opts.sandbox ? { sandbox: this.sandboxFor(agentId, sandboxDecisions) } : {}),
            signal: controller.signal,
        };
        const timeoutMs = toolDef.timeoutMs ?? this.opts.toolTimeoutMs;
        const graceMs = this.opts.toolTimeoutGraceMs ?? 2000;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let graceTimer: ReturnType<typeof setTimeout> | undefined;

        const execution = (async (): Promise<{ result: string; success: boolean; errorCode?: string }> => {
            try {
                const args = JSON.parse(call.args);
                return { result: await toolDef.execute(args, ctx), success: true };
            } catch (err) {
                const errorCode = errorCodeOf(err);
                return { result: `Error: ${err instanceof Error ? err.message : String(err)}`, success: false, ...(errorCode ? { errorCode } : {}) };
            }
        })();
        // A result that arrives after we gave up on the call is dropped, never an unhandled rejection.
        execution.catch(() => undefined);

        // Resolves with the reason as soon as the call is aborted or its time limit passes.
        const interrupted = new Promise<'timeout' | 'aborted'>((resolve) => {
            if (timeoutMs && timeoutMs > 0) {
                timer = setTimeout(() => { controller.abort('timeout'); resolve('timeout'); }, timeoutMs);
            }
            controller.signal.addEventListener('abort', () => {
                resolve(controller.signal.reason === 'timeout' ? 'timeout' : 'aborted');
            }, { once: true });
        });

        try {
            const first = await Promise.race([execution, interrupted]);
            if (first !== 'timeout' && first !== 'aborted') return first;

            // Interrupted: give the tool a moment to react to the signal, then answer either way.
            await Promise.race([
                execution,
                new Promise<void>((resolve) => { graceTimer = setTimeout(resolve, graceMs); }),
            ]);
            return first === 'timeout'
                ? { result: `Error: TOOL_TIMEOUT: tool "${call.name}" exceeded ${timeoutMs}ms${toolDef.readOnly ? '' : '. It may still be running and its effect may still happen: check before trying it again.'}`, success: false, outcome: 'timeout' }
                : { result: `Error: aborted: tool "${call.name}" was cancelled`, success: false, outcome: 'aborted' };
        } finally {
            clearTimeout(timer);
            clearTimeout(graceTimer);
            this.toolControllers.delete(controller);
        }
    }

    /**
     * Disconnects an MCP server at runtime — reverts all tool assignments and
     * command blocks it applied to local agents. After calling this, agents that
     * had tools from this server lose them from allowedTools, and any commands
     * that were blocked via blocksCommands are unblocked.
     *
     * For mode='agent' servers, the wrapper agent is also removed from the roster.
     * For mode='tools' servers, agents fall back to shell commands automatically.
     */
    unregisterMCPServer(serverName: string): void {
        this.mcpRegistrar.unregisterServer(serverName);
    }

    /**
     * Disable approval for the rest of this session (approve_all). In the policy path it affects only the adapted
     * onToolApproval callback, and never covers what only a person may approve (destructive tools, package installs).
     */
    disableToolApproval(): void { this.approvalGate.disable(); this.callbackApprover?.disable(); }

    /** Re-enable approval gate (e.g. after /iteration manual). */
    enableToolApproval(): void { this.approvalGate.enable(); this.callbackApprover?.enable(); }


    /** The principal of a call: this engine's identity, the executing agent and its delegation chain. */
    private principalFor(agentId: string, chain?: string[]): Principal {
        const agentIdentity = this.identities.peek(agentId);
        return {
            ...this.opts.identity,
            agentId,
            ...(agentIdentity ? { agentIdentity } : {}),
            sessionId: this.opts.sessionId ?? 'default',
            chain: chain && chain.length > 0 ? chain : [agentId],
        };
    }

    /**
     * Writes the single `AuditEvent` of a tool call (or delegation). Arguments only as a hash: the raw JSON string
     * the model produced is parsed when it can be (so equal arguments hash equal whatever their key order) and
     * hashed as text when it cannot.
     */
    private async recordAudit(c: {
        startedAt: number; agentId: string; chain?: string[]; /** Whom the call acted for, when the principal of the engine does not say (a stored approval run by a worker). */ userId?: string; tool: string; rawArgs: string | Record<string, unknown>;
        decision: AuditDecision; reason?: string; outcome?: AuditOutcome; errorCode?: string; sandbox?: AuditSandboxDecision[];
        approval?: { id: string; by: ApproverRef; authority?: ApproverAuthority; reason?: string }; credentials?: AuditCredential[]; mandate?: AuditMandate; exceeded?: AuditMandate; meta?: Record<string, unknown>;
    }): Promise<void> {
        if (!this.audit.enabled) return;
        let args: unknown = c.rawArgs;
        if (typeof c.rawArgs === 'string') {
            try { args = JSON.parse(c.rawArgs); } catch { args = c.rawArgs; }
        }
        const own = this.principalFor(c.agentId, c.chain);
        const p: Principal = own.userId === undefined && c.userId !== undefined ? { ...own, userId: c.userId } : own;
        // The identity the call is attributed to: the one already resolved for it (the policy saw it), or asked for now. A failure is not hidden.
        const who = await this.identities.check(c.agentId, { sessionId: p.sessionId, ...(p.tenantId !== undefined ? { tenantId: p.tenantId } : {}), ...(p.userId !== undefined ? { userId: p.userId } : {}) });
        const attributed = who.ok ? who.identity : this.identities.peek(c.agentId);
        const event: AuditEvent = {
            at: new Date(c.startedAt).toISOString(),
            ...(this.currentRunId ? { runId: this.currentRunId } : {}),
            principal: {
                agentId: p.agentId, sessionId: p.sessionId, chain: p.chain,
                ...(p.tenantId !== undefined ? { tenantId: p.tenantId } : {}),
                ...(p.userId !== undefined ? { userId: p.userId } : {}),
            },
            ...(attributed ? { agentIdentity: attributed } : { agentIdentityMissing: true as const }),
            tool: c.tool,
            argsHash: hashArgs(args),
            decision: c.decision,
            ...(c.reason !== undefined ? { reason: c.reason } : {}),
            ...(c.outcome !== undefined ? { outcome: c.outcome } : {}),
            ...(c.errorCode ? { errorCode: c.errorCode } : {}),
            durationMs: Date.now() - c.startedAt,
            ...(c.approval ? { approval: c.approval } : {}),
            ...(c.credentials ? { credentials: c.credentials } : {}),
            ...(c.mandate ? { mandate: c.mandate } : {}),
            ...(c.exceeded ? { exceeded: c.exceeded } : {}),
            ...(c.sandbox && c.sandbox.length > 0 ? { sandbox: c.sandbox } : {}),
            ...(c.meta ? { meta: c.meta } : {}),
        };
        await this.audit.write(await this.signed(event, who.ok ? who.identity : undefined, p));
    }

    /** The event signed by the identity it names (SPEC-0044 F2), or marked unsigned when the identity cannot sign: the record is never lost. */
    private async signed(event: AuditEvent, identity: AgentIdentity | undefined, p: Principal): Promise<AuditEvent> {
        if (this.opts.signAuditEvents === false || !identity || !event.agentIdentity || !this.identities.canSign) return event;
        try {
            const agentSignature = await this.identities.sign(p.agentId, { sessionId: p.sessionId, ...(p.tenantId !== undefined ? { tenantId: p.tenantId } : {}), ...(p.userId !== undefined ? { userId: p.userId } : {}) }, eventSigningMessage(event));
            return { ...event, agentSignature };
        } catch {
            return { ...event, agentSignatureFailed: true };
        }
    }

    private buildContext(agentId?: string, depth = 0, chain?: string[]): ExecutionContext {
        const id = agentId ?? this.currentAgentId;
        const principal = this.principalFor(id, chain);
        const profile = this.opts.agents.get(id);
        const additionalRoots = this.opts.additionalRoots ?? [];
        const serviceSource = this.opts.services;
        const serviceMap = serviceSource
            ? new Map(Object.entries(typeof serviceSource === 'function' ? serviceSource(profile) : serviceSource))
            : undefined;
        return {
            agentId: id,
            sessionId: this.opts.sessionId ?? 'default',
            principal,
            workingDir: this.opts.workingDir,
            memory: this.memory,
            ...(serviceMap ? { services: serviceMap } : {}),
            advancedMemory: this.opts.memorySystem,
            ...(additionalRoots.length ? { additionalRoots } : {}),
            // A tool delegates on behalf of its agent: the same check as the model's `ask_agent`, and one audit event either way.
            askAgent: async (agentId, question, context) => {
                const call = { agentId, question, ...(context !== undefined ? { context } : {}) };
                const startedAt = Date.now();
                const verdict = profile
                    ? await this.authorizeDelegation(profile, call, principal.chain)
                    : { ok: false as const, message: `Delegation refused: agent "${id}" is not registered`, decision: 'not_allowed' as const, reason: `agent "${id}" is not registered` };
                if (!verdict.ok) {
                    await this.recordAudit({ startedAt, agentId: id, chain: principal.chain, tool: 'ask_agent', rawArgs: delegationArgs(call), decision: verdict.decision, reason: verdict.reason });
                    throw new Error(verdict.message);
                }
                const result = await this.bus.runSingle({ agentId, question, context, fromAgentId: id, depth: depth + 1, chain: principal.chain });
                await this.recordAudit({
                    startedAt, agentId: id, chain: principal.chain, tool: 'ask_agent', rawArgs: delegationArgs(call),
                    decision: 'allow', ...(result.error ? { reason: result.error } : {}), outcome: result.error ? 'error' : 'ok',
                });
                return result.content;
            },
            emitCompacting: (phase, label) => {
                this.transport.emit({ type: 'compacting', phase, label });
            },
            // Counted in the budget like any call of this agent; a provider error reaches the tool instead of becoming ''.
            llmCall: async (prompt: string): Promise<string> => {
                const profile = this.opts.agents.get(id);
                if (!profile) throw new Error(`llmCall: agent "${id}" is not registered`);
                const text = await this.singleCall(this.getProviderForProfile(profile), prompt, {
                    agentId: id, provider: profile.provider ?? this.opts.defaultProvider, purpose: 'tool_llm_call',
                }, profile.model);
                return text.trim();
            },
        };
    }
}
