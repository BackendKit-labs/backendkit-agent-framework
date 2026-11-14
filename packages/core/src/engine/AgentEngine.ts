import { ApprovalGate } from './ApprovalGate';
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
import { combineDecisions, defaultToolPolicy, evaluatePolicies } from '../governance/policy';
import { approvalProblem, approverFromCallback, type CallbackApprover } from '../governance/approval';
import { packageInstallPolicy } from './package-install';
import { DEFAULT_MAX_HOOK_CONTINUES, runHooks, type ContinueTurn, type EngineHooks, type RunContext } from '../governance/hooks';
import type {
    ApprovalRequest,
    ApprovalStore,
    Approver,
    ApproverRef,
    AuditDecision,
    AuditEvent,
    AuditOutcome,
    AuditSandboxDecision,
    AuditSink,
    Identity,
    PolicyDecision,
    Principal,
    ToolCall,
    ToolPolicy,
} from '../governance/types';
import { hashArgs } from '../shared/utils/canonical-json';

/** What the policy path decided about one call, before it runs (SPEC-0014 F2). */
type GovernedVerdict =
    | { run: true; mode?: 'run' | 'sandboxed' | 'dry_run'; approval?: { id: string; by: ApproverRef } }
    | { run: false; decision: 'deny' | 'ask' | 'sandbox_denied'; reason: string; message: string };
import type {
    AgentProfile,
    EngineOptions,
    ExecutionContext,
    LLMMessage,
    LLMProvider,
    SessionMemoryData,
    ToolDefinition,
    Skill,
} from '../types';
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
import type { Orchestrator } from '../orchestration/orchestrator';
import type { OrchestrationResult } from '../orchestration/types';
import type { QAService } from '../qa/qa-service';
import { IterationManager, type IterationMode, type IterationStats } from './IterationManager';
import {
    advanceRequiredGates,
    activateQaEngineerIfNeeded,
    processQaEngineerResponse,
    processInlineQaReview,
} from './qa-orchestrator';


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
    /** Orchestrator para clasificacion de tareas, risk scoring y FSM */
    orchestrator?: Orchestrator;
    /**
     * What run() does when the orchestrator throws. 'closed' (default) rethrows: the gates it would have
     * applied cannot be silently skipped. 'open' warns on the transport and runs without orchestration.
     */
    orchestratorFailureMode?: 'closed' | 'open';
    /** QA service para revisar respuestas y registrar gates */
    qaService?: QAService;
    /** Si true, deshabilita las revisiones de QA automaticas */
    noQA?: boolean;
    /** Callback invocado cuando el QA genera una revision */
    onQAReview?: (review: string) => void;
    /** MCP client manager — connects to external MCP servers and registers their tools */
    mcpManager?: MCPClientManager;
    /**
     * Called before executing write/execute tools (write_file, edit_file, run_command) when
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
    /** Policy path (SPEC-0014 F2) instead of the legacy ApprovalGate: on when policy, approver or approvals is set. */
    private readonly governed: boolean;
    private readonly policies: ToolPolicy[];
    private readonly approver?: Approver;
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

    constructor(private readonly opts: AgentEngineOptions) {
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
                emit: (event) => this.opts.transport.emit(event),
            });
        }
        this.auditLogger = new AuditLogger(opts.auditLog);
        // A sink that fails must not change what the agent already did, but it must not fail silently either.
        this.audit = new AuditDispatcher(opts.audit, (err) => this.opts.transport.emit({
            type: 'system', level: 'warn',
            text: `[audit] a sink failed to record a tool call: ${err instanceof Error ? err.message : String(err)}`,
        }));
        this.hooks = opts.hooks ?? [];
        this.governed = !!(opts.policy || opts.approver || opts.approvals);
        if (this.governed) {
            const someoneToAsk = !!(opts.approver || opts.approvals || opts.onToolApproval);
            const configured = opts.policy ? (Array.isArray(opts.policy) ? opts.policy : [opts.policy]) : [];
            // Package installs always ask a person; it moves to the coding vertical with SPEC-0015 F3.
            this.policies = [
                ...(configured.length > 0 ? configured : someoneToAsk ? [defaultToolPolicy] : []),
                packageInstallPolicy,
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
            transport:  opts.transport,
        });
        this.approvalGate = new ApprovalGate({
            onToolApproval: opts.onToolApproval,
            transport:      opts.transport,
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
            transport: opts.transport,
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
                this.opts.transport.emit(metricsEvent(inputTokens, outputTokens, usage, {
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
        const provider = this.opts.providers.resolve(undefined, this.opts.defaultProvider);
        return new Promise<string>((resolve, reject) => {
            const chunks: string[] = [];
            provider.chat(
                [{ role: 'user', content: prompt }],
                [],
                {
                    onChunk(delta) { chunks.push(delta); },
                    onDone()       { resolve(chunks.join('')); },
                    onError(err)   { reject(err); },
                },
            );
        });
    }

    private getProviderForProfile(profile: AgentProfile): LLMProvider {
        return this.opts.providers.resolve(profile.provider, this.opts.defaultProvider);
    }

    async run(input: string): Promise<void> {
        // Serialize concurrent calls — messages, currentAgentId, and other fields are
        // shared mutable state that is not safe for concurrent access.
        let release!: () => void;
        const slot = new Promise<void>(r => { release = r; });
        const prev = this.runMutex;
        this.runMutex = prev.then(() => slot);
        await prev;
        try {
            await this._run(input);
        } finally {
            release();
        }
    }

    private async _run(input: string): Promise<void> {
        if (this.pendingContextLoad) await this.pendingContextLoad;
        this.aborted = false;
        this.opts.transport.emit({ type: 'ready' });

        // Fix #17: reject inputs that exceed the hard cap to prevent prompt injection via huge payloads
        if (Buffer.byteLength(input, 'utf-8') > MAX_INPUT_BYTES) {
            this.opts.transport.emit({
                type: 'error',
                message: `Input too large (${Buffer.byteLength(input, 'utf-8').toLocaleString()} bytes). Maximum is ${MAX_INPUT_BYTES.toLocaleString()} bytes.`,
            });
            this.opts.transport.emit({ type: 'done' });
            return;
        }

        if (this.guardrails?.has('input')) {
            const checked = await this.guard('input', input, this.currentAgentId);
            if (checked.blocked) {
                this.opts.transport.emit({
                    type: 'error',
                    message: `Input blocked by guardrail "${checked.blocked.guardrail}": ${checked.blocked.reason}`,
                });
                this.opts.transport.emit({ type: 'done' });
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
                    this.opts.transport.emit({
                        type: 'block_start',
                        agent_id: mcpRoute.agentId,
                        agent_name: mcpProfile.name ?? mcpRoute.agentId,
                        agent_icon: mcpProfile.icon ?? '◎',
                    });
                    const result = await this.executeToolCall(
                        { name: toolName, args: JSON.stringify({ [firstParam]: input }) },
                        mcpProfile,
                    );
                    this.opts.transport.emit({ type: 'token', content: result, agent_id: mcpRoute.agentId });
                    this.opts.transport.emit({ type: 'block_end', status: 'ok', agent_id: mcpRoute.agentId });
                    this.opts.transport.emit({ type: 'done' });
                    return;
                }
            }
            // Agent trigger fallback: route to the agent's LLM session
            await this.runAgentInternal(mcpRoute.agentId, input);
            this.opts.transport.emit({ type: 'done' });
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

        // Orquestar la tarea para obtener clasificacion, risk scoring y gates requeridos
        let orchestrationResult: OrchestrationResult | undefined;
        if (this.opts.orchestrator) {
            try {
                orchestrationResult = await this.opts.orchestrator.orchestrate(input);
            } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                if ((this.opts.orchestratorFailureMode ?? 'closed') === 'closed') {
                    throw new Error(`Orchestrator failed; refusing to run without its gates: ${reason}`);
                }
                this.opts.transport.emit({ type: 'system', level: 'warn', text: `[Orchestrator] failed (${reason}); running without classification or gates` });
            }
        }

        // Hooks of this turn share one context (SPEC-0014 F3). A throwing hook fails the turn.
        this.runController = new AbortController();
        this.lastAnswer = '';
        this.runCtx = {
            principal: this.principalFor(profile.id),
            input,
            state: new Map(),
            signal: this.runController.signal,
            emit: (event) => this.opts.transport.emit(event),
        };
        try {
            await runHooks(this.hooks, 'beforeRun', h => h.beforeRun!(this.runCtx!));

            this.history.push({ role: 'user', content: input });
            await this.runLoop(profile, orchestrationResult);
            this.saveHistory();

            const finished = this.runCtx;
            await runHooks(this.hooks, 'afterRun', h => h.afterRun!(finished, { text: this.lastAnswer }));
        } finally {
            this.runCtx = undefined;
            this.runController = undefined;
        }
        this.opts.transport.emit({ type: 'done' });
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
            : { principal, input: '', state: new Map(), signal: new AbortController().signal, emit: (e) => this.opts.transport.emit(e) };
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
            transport: this.opts.transport,
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
        return this.executeToolCall(
            { name: subject.call.tool.name, args: JSON.stringify(subject.call.args) },
            profile, 0, undefined, undefined, item.principal.chain,
            { by: item.outcome.by, approvalId },
        );
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
            this.opts.transport.emit({
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
                    this.opts.transport.emit({
                        type: 'system', level: 'info',
                        text: `[Context] ~${report.tokensBefore} → ~${report.tokensAfter} tokens ` +
                              `(truncated ${report.truncatedToolResults} tool results, summarized ${report.summarizedMessages}, dropped ${report.droppedMessages} messages)`,
                    });
                }
            } catch (err) {
                // Compaction is best-effort: a bug here must never stop the agent.
                this.opts.transport.emit({ type: 'system', level: 'warn', text: `[Context] Compaction failed: ${err instanceof Error ? err.message : String(err)}` });
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
        this.opts.transport.emit({
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
                        this.opts.transport.emit(metricsEvent(inputTokens, outputTokens, usage, {
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
            this.opts.transport.emit({
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
            this.opts.transport.emit({
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

    private buildAgentRoster(excludeId: string): string {
        const all = this.opts.agents.getAll().filter(a => a.id !== excludeId);
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

    private buildSystemPrompt(profile: AgentProfile, orchestrationResult?: OrchestrationResult, hookSections: string[] = []): string {
        const isOrchestrator = profile.id === this.opts.defaultAgentId;
        const parts: string[] = [profile.systemPrompt];
        if (isOrchestrator) parts.push(this.buildAgentRoster(profile.id));
        if (this.opts.workingDir) {
            parts.push(
                `## Working Directory\n` +
                `\`${this.opts.workingDir}\`\n\n` +
                `ALWAYS use RELATIVE paths with tools (e.g. \`src/index.ts\`, \`package.json\`). ` +
                `NEVER invent absolute paths like \`/workspace/...\` or \`/home/...\`.`
            );
        }
        if (this.opts.projectContext) parts.push(this.opts.projectContext);
        // Per-agent session notes (tool quirks, learnings routed by LearningRouter)
        const agentNotes = this.opts.store?.getAgentNotes?.(profile.id);
        if (agentNotes) parts.push(`## Agent Session Notes\n${agentNotes}`);
        if (this.memoryContextBlock) parts.push(this.memoryContextBlock);
        if (this.activeSkillAddition) parts.push(this.activeSkillAddition);
        if (isOrchestrator && orchestrationResult) {
            parts.push(this.buildOrchestrationBrief(orchestrationResult));
        }
        parts.push(...hookSections);
        return parts.join('\n\n');
    }

    /**
     * Converts an OrchestrationResult into a system-prompt section that tells the
     * default agent which specialists to use, in what order, and what gates apply.
     * This closes the gap between the deterministic policy layer and the LLM layer.
     */
    private buildOrchestrationBrief(result: OrchestrationResult): string {
        const { task, selectedAgents, agentPipeline, requiredGates } = result;

        const lines: string[] = ['## Orchestrator Analysis — Current Task'];

        const domains = task.domains.length > 0 ? task.domains.join(', ') : 'general';
        lines.push(`**Intent:** ${task.actionType} | **Risk:** ${task.riskLevel} | **Domains:** ${domains}`);

        // Only surface non-trivial agent selections (skip sole-fallback case)
        const nonFallback = selectedAgents.filter(a => !(a.agentId === 'general' && a.score <= 50));
        if (nonFallback.length > 0) {
            lines.push('\n**Recommended agents for this task (highest priority first):**');
            for (const a of nonFallback) {
                lines.push(`- ${a.agentId} — ${a.reason}`);
            }
            lines.push(
                '\nWhen delegating via ask_agent, prioritize the agents listed above. ' +
                'Do not delegate to unlisted agents unless the task explicitly requires it.'
            );
        }

        if (agentPipeline && agentPipeline.length > 0) {
            lines.push('\n**Suggested execution pipeline (respect this order):**');
            agentPipeline.forEach((phase, i) => {
                lines.push(`${i + 1}. [${phase.phase}] ${phase.agentId} — ${phase.purpose}`);
            });
        }

        if (requiredGates.length > 0) {
            lines.push(`\n**Required gates before commit:** ${requiredGates.join(', ')}`);
            lines.push('Ensure each gate is satisfied before considering the task complete.');
        }

        return lines.join('\n');
    }

    private resolvesDelegateTo(profile: AgentProfile): string[] {
        if (!profile.delegatesTo || profile.delegatesTo.length === 0) return [];
        if (profile.delegatesTo[0] === '*') {
            return this.opts.agents.getAll()
                .map(a => a.id)
                .filter(id => id !== profile.id);
        }
        return profile.delegatesTo as string[];
    }

    private getToolsForAgent(profile: AgentProfile): ToolDefinition[] {
        const tools = this.opts.tools.getForAgent(profile.allowedTools);
        // ask_agent solo tiene sentido si el agente por defecto tiene a quien
        // delegar. En un engine de un solo agente, profile.id === defaultAgentId
        // es trivialmente cierto y antes se le ofrecia la tool igual, sin ningun
        // target valido en el roster — si el modelo la llamaba, el turno completo
        // se perdia sin texto visible y sin error (ver bug del pulso de mercado,
        // agente_bk, 2026-07-24).
        const hasDelegationTarget = this.opts.agents.getAll().some(a => a.id !== profile.id);
        if (profile.id === this.opts.defaultAgentId && hasDelegationTarget) {
            tools.push(ASK_AGENT_TOOL);
        }
        return tools;
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

    private async runLoop(profile: AgentProfile, orchestrationResult?: OrchestrationResult): Promise<void> {
        let currentProfile = profile;

        this.iterationManager.reset();
        const iterManager = this.iterationManager;
        let overflowRetries = 0;
        let hookContinues = 0;

        this.opts.transport.emit({
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
                content: this.buildSystemPrompt(currentProfile, orchestrationResult, await this.hookPromptSections(currentProfile)),
            };
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
                        else this.opts.transport.emit({ type: 'token', content: delta, agent_id: currentProfile.id });
                    },
                    onToolCall: (name, args, id) => {
                        this.opts.transport.emit({ type: 'tool_call', name, args_preview: args.slice(0, 200) });
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
                        this.opts.transport.emit({ type: 'error', message: err.message });
                    },
                    onMetrics: (inputTokens, outputTokens, usage) => {
                        // Anthropic reports cached tokens apart from input_tokens; the request still carried them.
                        this.contextManager?.observeUsage(
                            inputTokens + (usage?.cacheReadTokens ?? 0) + (usage?.cacheWriteTokens ?? 0),
                            this.lastRequestEstimate,
                        );
                        this.opts.transport.emit(metricsEvent(inputTokens, outputTokens, usage, {
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
                this.opts.transport.emit({ type: 'error', message: (overflowError as Error).message });
                break;
            }

            if (!finalMessage) break;

            const guardedOut = await this.guardOutput(finalMessage as LLMMessage, currentProfile.id);
            finalMessage = guardedOut.message;
            if (guardedOut.touched) streamBuffer = guardedOut.text;
            if (holdOutput) {
                const shown = guardedOut.touched ? guardedOut.text : heldTokens.join('');
                if (shown) this.opts.transport.emit({ type: 'token', content: shown, agent_id: currentProfile.id });
            }

            this.history.push(finalMessage);

            const toolResults: LLMMessage[] = [];

            // ── ask_agent: parallel if 2+ calls ──────────────────────────────
            if (askAgentCalls.length > 0) {
                const validCalls = askAgentCalls.filter(c => c.agentId !== currentProfile.id);
                const selfCalls  = askAgentCalls.filter(c => c.agentId === currentProfile.id);

                // Delegations are audited like any tool call: one event each (SPEC-0014 F1).
                const delegationArgs = (c: { agentId: string; question: string; context?: string }) =>
                    ({ agent_id: c.agentId, question: c.question, ...(c.context !== undefined ? { context: c.context } : {}) });

                for (const call of selfCalls) {
                    const startedAt = Date.now();
                    const msg = `Self-delegation blocked: agent "${currentProfile.id}" cannot delegate to itself. Execute the task directly.`;
                    this.opts.transport.emit({ type: 'tool_result', name: 'ask_agent', success: false, preview: msg });
                    toolResults.push({ role: 'tool', tool_call_id: call.id, content: msg });
                    await this.recordAudit({
                        startedAt, agentId: currentProfile.id, tool: 'ask_agent', rawArgs: delegationArgs(call),
                        decision: 'not_allowed', reason: 'self-delegation',
                    });
                }

                // In the policy path a delegation is a call like any other: the policies may deny it or ask first.
                const callerChain = this.principalFor(currentProfile.id).chain;
                const allowedCalls: typeof validCalls = [];
                for (const call of validCalls) {
                    if (!this.governed) { allowedCalls.push(call); continue; }
                    const startedAt = Date.now();
                    const verdict = await this.decideGoverned(
                        ASK_AGENT_TOOL, JSON.stringify(delegationArgs(call)), this.principalFor(currentProfile.id, callerChain), [],
                    );
                    if (verdict.run) { allowedCalls.push(call); continue; }
                    this.opts.transport.emit({ type: 'tool_result', name: 'ask_agent', success: false, preview: verdict.message.slice(0, 120) });
                    toolResults.push({ role: 'tool', tool_call_id: call.id, content: verdict.message });
                    await this.recordAudit({
                        startedAt, agentId: currentProfile.id, chain: callerChain, tool: 'ask_agent',
                        rawArgs: delegationArgs(call), decision: verdict.decision, reason: verdict.reason,
                    });
                }
                validCalls.splice(0, validCalls.length, ...allowedCalls);

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
                        this.opts.transport.emit({ type: 'tool_result', name: 'ask_agent', success: !result.error, preview: content.slice(0, 120) });
                        toolResults.push({ role: 'tool', tool_call_id: call.id, content });
                        await this.recordAudit({
                            startedAt, agentId: currentProfile.id, chain: callerChain, tool: 'ask_agent', rawArgs: delegationArgs(call),
                            decision: 'allow', ...(result.error ? { reason: result.error } : {}),
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
                    for (const e of buffers[i]) this.opts.transport.emit(e);
                    toolResults.push({ role: 'tool', tool_call_id: call.id, content: results[i] });
                });
            }

            // ── QA orchestration: runs when response is final (no tool calls) ─
            if (toolResults.length === 0 && this.opts.orchestrator && this.opts.qaService && orchestrationResult) {
                const qaAgentId = this.opts.agents.has('qa-engineer') ? 'qa-engineer' : undefined;
                const qaCtx = {
                    clean: streamBuffer,
                    orchestrationResult,
                    orchestrator: this.opts.orchestrator,
                    qaService: this.opts.qaService,
                    allAgents: this.opts.agents.getAll(),
                    messages: this.history.getAll(),
                    effectiveAgentId: currentProfile.id,
                    defaultAgentId: this.opts.defaultAgentId,
                    qaAgentId,
                    noQA: this.opts.noQA,
                    onQAReview: this.opts.onQAReview,
                    setEffectiveAgent: (agentId: string) => {
                        const p = this.opts.agents.get(agentId);
                        if (p) currentProfile = p;
                    },
                };

                await advanceRequiredGates(qaCtx);

                const qaProfile = activateQaEngineerIfNeeded(qaCtx);
                if (qaProfile) {
                    currentProfile = qaProfile;
                    continue; // re-enter loop as qa-engineer
                }

                if (qaAgentId && currentProfile.id === qaAgentId) {
                    await processQaEngineerResponse(qaCtx);
                    currentProfile = profile; // reset to original agent
                } else {
                    await processInlineQaReview(qaCtx);
                }
            }

            if (toolResults.length === 0) {
                // The model answered without tools: afterTurn hooks may force another pass (SPEC-0014 F3).
                this.lastAnswer = streamBuffer;
                const next = await this.afterTurnHooks(currentProfile, streamBuffer);
                if (!next) break;
                const cap = this.opts.maxHookContinues ?? DEFAULT_MAX_HOOK_CONTINUES;
                if (hookContinues >= cap) {
                    this.opts.transport.emit({ type: 'system', level: 'warn', text: `[hooks] afterTurn asked for more than ${cap} extra passes; stopping` });
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

        this.opts.transport.emit({ type: 'block_end', status: 'ok', agent_id: profile.id });
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

        const messages: LLMMessage[] = [
            { role: 'system', content: this.buildSystemPrompt(profile, undefined, await this.hookPromptSections(profile)) },
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
            else this.opts.transport.emit(event);
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
        this.opts.transport.emit({
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
        const emitEvent = emit ?? ((e) => this.opts.transport.emit(e));
        const callStart = Date.now();
        const toolDef = this.opts.tools.get(call.name);
        const principal = this.principalFor(profile.id, chain);
        let result: string;
        let success: boolean;
        let outcome: 'timeout' | 'aborted' | undefined;
        let sandboxRefusal: string | undefined;
        // What the single audit event of this call records (SPEC-0014 F1).
        let decision: AuditDecision = 'allow';
        let reason: string | undefined;
        let ran = false;
        let approval: { id: string; by: ApproverRef } | undefined;
        const sandboxDecisions: AuditSandboxDecision[] = [];

        if (!toolDef) {
            result  = `Tool "${call.name}" not found`;
            success = false;
            decision = 'not_found';
        } else if (
            !profile.allowedTools.includes(call.name) &&
            !(this.opts.allowUnlistedTools && profile.allowedTools.length === 0 && !(profile.delegatesTo && profile.delegatesTo.length > 0))
        ) {
            result  = `Tool "${call.name}" is not authorized for agent "${profile.id}". ` +
                      (profile.delegatesTo && profile.delegatesTo.length > 0
                          ? `Use ask_agent to delegate to a specialist.`
                          : `Add it to the agent's allowedTools if it should be able to use it.`);
            success = false;
            decision = 'not_allowed';
            reason = `not in the allowedTools of agent "${profile.id}"`;
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
                const verdict = this.governed
                    ? await this.decideGoverned(toolDef, effective.args, principal, sandboxDecisions, approved)
                    : await this.decideLegacy(effective, profile.id, sandboxDecisions);
                if (!verdict.run) {
                    result = verdict.message; success = false;
                    decision = verdict.decision;
                    reason = verdict.reason;
                } else {
                    ran = true;
                    approval = verdict.approval;
                    const toolHooks = this.hooks.some(h => h.beforeTool || h.afterTool);
                    const hookCall: ToolCall | undefined = toolHooks ? { tool: toolDef, args: this.parseArgs(effective.args) } : undefined;
                    const hookCtx = toolHooks ? this.toolHookContext(principal) : undefined;
                    if (hookCall && hookCtx) await runHooks(this.hooks, 'beforeTool', h => h.beforeTool!(hookCtx, hookCall));
                    ({ result, success, outcome } = await this.runToolDef(
                        effective, toolDef, profile.id, depth, sandboxDecisions, principal, verdict.mode === 'dry_run',
                    ));
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
            tool: call.name,
            rawArgs: call.args,
            decision,
            reason,
            outcome: ran ? (outcome ?? (success ? 'ok' : 'error')) : undefined,
            approval,
            sandbox: sandboxDecisions,
            meta: toolDef?.meta,
        });
        // Strip ANSI before slicing to avoid partial escape sequences in the preview
        // eslint-disable-next-line no-control-regex
        const cleanPreview = result.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
        emitEvent({
            type: 'tool_result', name: call.name, success, preview: cleanPreview.slice(0, 120),
            agent_id: profile.id, started_at: callStart, duration_ms: Date.now() - callStart,
            ...(outcome ? { outcome } : {}),
        });
        return result;
    }

    /** Approval checks never overlap and run in call order, even inside a parallel wave. */
    private gateQueue: Promise<unknown> = Promise.resolve();
    private serialize<T>(work: () => Promise<T>): Promise<T> {
        const next = this.gateQueue.then(work);
        this.gateQueue = next.catch(() => undefined);
        return next;
    }

    /** The legacy gate (onToolApproval + the built-in list of tools that ask), unchanged, as a verdict. */
    private async decideLegacy(
        call: { name: string; args: string }, agentId: string, sandboxDecisions: AuditSandboxDecision[],
    ): Promise<GovernedVerdict> {
        const sandboxAsk = this.opts.sandbox?.approvalFor
            ? this.opts.sandbox.approvalFor({ agentId, sessionId: this.opts.sessionId ?? 'default' }, call.name)
            : undefined;
        const gate = await this.serialize(() => this.approvalGate.check(call, agentId, sandboxAsk));
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

    /**
     * The policy path (SPEC-0014 §2, F2): the policies decide on the arguments that would really run (after the
     * guardrails), a sandbox that wants approval adds an `ask`, and an `ask` goes to the approver in call order or,
     * when nobody answers now, to the durable store.
     */
    private async decideGoverned(
        tool: ToolDefinition, rawArgs: string, principal: Principal, sandboxDecisions: AuditSandboxDecision[],
        approved?: ToolCall['approved'],
    ): Promise<GovernedVerdict> {
        // `approved` is never taken from what the model sent: only `runApproved`, which holds a stored approval, sets it.
        const call: ToolCall = { tool, args: this.parseArgs(rawArgs), ...(approved ? { approved } : {}) };
        const sandboxAsk = this.opts.sandbox?.approvalFor?.({ agentId: principal.agentId, sessionId: principal.sessionId }, tool.name) === 'ask';

        let d = await evaluatePolicies(this.policies, principal, call);
        if (sandboxAsk) d = combineDecisions([d, { effect: 'ask', reason: 'the sandbox policy requires approval' }]);

        if (d.effect === 'deny') {
            return { run: false, decision: 'deny', reason: d.reason, message: `Tool call "${tool.name}" denied by policy: ${d.reason}` };
        }
        if (d.effect === 'allow') {
            if (d.mode === 'sandboxed' && !this.opts.sandbox) {
                const reason = 'the policy requires a sandbox and none is configured';
                return { run: false, decision: 'deny', reason, message: `Tool call "${tool.name}" denied by policy: ${reason}` };
            }
            return { run: true, ...(d.mode ? { mode: d.mode } : {}), ...(approved ? { approval: { id: approved.approvalId, by: approved.by } } : {}) };
        }
        const ask = d as Extract<PolicyDecision, { effect: 'ask' }>;
        if (approved) {
            // A stored approval satisfies the ask, but only if its approver is one this ask accepts (§6.2).
            const problem = await approvalProblem(
                { decision: 'approve', by: approved.by, at: new Date().toISOString() },
                { principal, ...(ask.accepts ? { accepts: ask.accepts } : {}) },
                (by) => this.agentCanPerform(by, call),
            );
            if (problem) {
                const reason = `invalid approval: ${problem}`;
                return { run: false, decision: 'deny', reason, message: `Tool call "${tool.name}" not run: ${reason}` };
            }
            return { run: true, approval: { id: approved.approvalId, by: approved.by } };
        }
        return this.serialize(() => this.resolveAsk(principal, call, ask, sandboxAsk, sandboxDecisions));
    }

    private async resolveAsk(
        principal: Principal, call: ToolCall, d: Extract<PolicyDecision, { effect: 'ask' }>,
        sandboxAsk: boolean, sandboxDecisions: AuditSandboxDecision[],
    ): Promise<GovernedVerdict> {
        const name = call.tool.name;
        const request: ApprovalRequest = {
            id: randomUUID(), principal, subject: { kind: 'tool_call', call }, reason: d.reason,
            ...(d.approver ? { approver: d.approver } : {}),
            ...(d.accepts ? { accepts: d.accepts } : {}),
            createdAt: new Date().toISOString(),
        };

        if (this.approver) {
            this.opts.transport.emit({
                type: 'tool_approval_request', tool_name: name, agent_id: principal.agentId,
                args_preview: JSON.stringify(call.args).slice(0, 200),
            });
            let answer;
            try {
                answer = await this.approver.request(request);
            } catch (err) {
                const reason = `the approver failed: ${err instanceof Error ? err.message : String(err)}`;
                return { run: false, decision: 'deny', reason, message: `Tool call "${name}" not run: ${reason}` };
            }
            if (answer.decision !== 'approve') {
                return {
                    run: false, decision: 'deny', reason: answer.reason ?? 'rejected by the approver',
                    message: `Tool call "${name}" was rejected by the approver.`,
                };
            }
            const problem = await approvalProblem(answer, request, (by) => this.agentCanPerform(by, call));
            if (problem) {
                const reason = `invalid approval: ${problem}`;
                return { run: false, decision: 'deny', reason, message: `Tool call "${name}" not run: ${reason}` };
            }
            return { run: true, approval: { id: request.id, by: answer.by } };
        }

        if (this.opts.approvals) {
            await this.opts.approvals.put(request);
            return {
                run: false, decision: 'ask', reason: d.reason,
                message: `Tool call "${name}" needs approval (${d.reason}) and is pending as request ${request.id}. ` +
                    'It has NOT run; it will run once someone approves it.',
            };
        }

        if (sandboxAsk) return this.noApproverForSandbox(name, principal.agentId, sandboxDecisions);
        const reason = `needs approval (${d.reason}) and no approver is configured`;
        return { run: false, decision: 'deny', reason, message: `Tool call "${name}" refused: ${reason}.` };
    }

    /**
     * Rule 3 of SPEC-0014 §6.2: an agent approves only what it could do itself. It must be registered, have the
     * tool in its allowedTools, and the policies must allow the same call with that agent as principal.
     */
    private async agentCanPerform(by: ApproverRef, call: ToolCall): Promise<boolean> {
        const approverProfile = this.opts.agents.get(by.id);
        if (!approverProfile) return false;
        if (!approverProfile.allowedTools.includes(call.tool.name)) return false;
        const d = await evaluatePolicies(this.policies, this.principalFor(by.id, by.chain ?? [by.id]), { tool: call.tool, args: call.args });
        return d.effect === 'allow';
    }

    private async runToolDef(
        call: { name: string; args: string },
        toolDef: import('../types').ToolDefinition,
        agentId: string,
        depth = 0,
        sandboxDecisions?: AuditSandboxDecision[],
        principal?: Principal,
        dryRun = false,
    ): Promise<{ result: string; success: boolean; outcome?: 'timeout' | 'aborted' }> {
        const controller = new AbortController();
        this.toolControllers.add(controller);
        const secrets = await resolveSecrets(this.opts.agents.get(agentId), this.opts.secretResolver);
        const ctx = {
            ...this.buildContext(agentId, depth, principal?.chain),
            ...(dryRun ? { dryRun: true } : {}),
            ...(Object.keys(secrets).length ? { secrets } : {}),
            ...(this.opts.jobs ? { jobs: this.opts.jobs } : {}),
            ...(this.opts.sandbox ? { sandbox: this.sandboxFor(agentId, sandboxDecisions) } : {}),
            signal: controller.signal,
        };
        const timeoutMs = toolDef.timeoutMs ?? this.opts.toolTimeoutMs;
        const graceMs = this.opts.toolTimeoutGraceMs ?? 2000;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let graceTimer: ReturnType<typeof setTimeout> | undefined;

        const execution = (async (): Promise<{ result: string; success: boolean }> => {
            try {
                const args = JSON.parse(call.args);
                return { result: await toolDef.execute(args, ctx), success: true };
            } catch (err) {
                return { result: `Error: ${err instanceof Error ? err.message : String(err)}`, success: false };
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
                ? { result: `Error: TOOL_TIMEOUT: tool "${call.name}" exceeded ${timeoutMs}ms`, success: false, outcome: 'timeout' }
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
        return {
            ...this.opts.identity,
            agentId,
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
        startedAt: number; agentId: string; chain?: string[]; tool: string; rawArgs: string | Record<string, unknown>;
        decision: AuditDecision; reason?: string; outcome?: AuditOutcome; sandbox?: AuditSandboxDecision[];
        approval?: { id: string; by: ApproverRef }; meta?: Record<string, unknown>;
    }): Promise<void> {
        if (!this.audit.enabled) return;
        let args: unknown = c.rawArgs;
        if (typeof c.rawArgs === 'string') {
            try { args = JSON.parse(c.rawArgs); } catch { args = c.rawArgs; }
        }
        const p = this.principalFor(c.agentId, c.chain);
        const event: AuditEvent = {
            at: new Date(c.startedAt).toISOString(),
            principal: {
                agentId: p.agentId, sessionId: p.sessionId, chain: p.chain,
                ...(p.tenantId !== undefined ? { tenantId: p.tenantId } : {}),
                ...(p.userId !== undefined ? { userId: p.userId } : {}),
            },
            tool: c.tool,
            argsHash: hashArgs(args),
            decision: c.decision,
            ...(c.reason !== undefined ? { reason: c.reason } : {}),
            ...(c.outcome !== undefined ? { outcome: c.outcome } : {}),
            durationMs: Date.now() - c.startedAt,
            ...(c.approval ? { approval: c.approval } : {}),
            ...(c.sandbox && c.sandbox.length > 0 ? { sandbox: c.sandbox } : {}),
            ...(c.meta ? { meta: c.meta } : {}),
        };
        await this.audit.write(event);
    }

    private buildContext(agentId?: string, depth = 0, chain?: string[]): ExecutionContext {
        const id = agentId ?? this.currentAgentId;
        const principal = this.principalFor(id, chain);
        const profile = this.opts.agents.get(id);
        const storeRoot = this.opts.store?.projectDir;
        const additionalRoots = [
            ...(this.opts.additionalRoots ?? []),
            ...(storeRoot ? [storeRoot] : []),
        ];
        return {
            agentId: id,
            sessionId: this.opts.sessionId ?? 'default',
            principal,
            workingDir: this.opts.workingDir,
            memory: this.memory,
            store: this.opts.store,
            advancedMemory: this.opts.memorySystem,
            ...(additionalRoots.length ? { additionalRoots } : {}),
            ...(profile?.blockedCommands?.length ? { blockedCommands: profile.blockedCommands } : {}),
            askAgent: async (agentId, question, context) => {
                const result = await this.bus.runSingle({ agentId, question, context, fromAgentId: id, depth: depth + 1, chain: principal.chain });
                return result.content;
            },
            emitCompacting: (phase, label) => {
                this.opts.transport.emit({ type: 'compacting', phase, label });
            },
            llmCall: async (prompt: string): Promise<string> => {
                const profile = this.opts.agents.get(id);
                if (!profile) return '';
                const provider = this.getProviderForProfile(profile);
                let result = '';
                await provider.chat(
                    [{ role: 'user', content: prompt }],
                    [],
                    {
                        onChunk:   (d) => { result += d; },
                        onToolCall: () => {},
                        onDone:    () => {},
                        onError:   () => {},
                    },
                );
                return result.trim();
            },
        };
    }
}
