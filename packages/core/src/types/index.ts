// ─── Agent Profile ────────────────────────────────────────────────────────────

export interface AgentProfile {
    id: string;
    name: string;
    icon: string;
    description: string;
    systemPrompt: string;
    allowedTools: string[];
    /** Agent IDs this agent can delegate to. Use ['*'] to allow delegation to all registered agents. */
    delegatesTo?: string[] | ['*'];
    suppressDefaultOutput?: boolean;
    provider?: string;
    /**
     * Model override for this agent. When set, overrides the model configured
     * in the provider. Use this to run lightweight agents on a cheaper model
     * (e.g. 'deepseek-chat') and heavy-reasoning agents on a smarter one
     * (e.g. 'deepseek-reasoner', 'claude-opus-4-8').
     * When omitted, the provider's default model is used.
     */
    model?: string;
    /** Where this agent was loaded from */
    source?: 'builtin' | 'global' | 'project' | 'registry' | 'mcp';
    /** Additional instructions appended to the base system prompt when this agent is active. */
    systemPromptAddition?: string;
    /**
     * Shell binaries this agent is NOT allowed to execute via run_command,
     * even if they are on the global COMMAND_ALLOWLIST.
     * Used to steer agents toward MCP tools when an equivalent capability exists.
     * Example: blockedCommands: ['docker'] forces data/backend to use pg_create
     * instead of running docker commands directly.
     */
    blockedCommands?: string[];
    /**
     * Credentials scoped to this agent, keyed by name (e.g. "AVAL_KEY",
     * "STRIPE_KEY"). Injected into ExecutionContext.secrets at call time so a
     * tool reads the caller's own credential instead of a process-wide
     * environment variable — the difference between "this agent can spend"
     * and "every agent shares one key that any of them could exceed or leak".
     *
     * A value is either the literal secret or a reference `{ env: "NAME" }` resolved on
     * every call (so a rotated variable applies without a restart; unset falls back to
     * the engine's `secretResolver`). Prefer references: literals live in the profile
     * file, which is not encrypted — treat it as sensitive like an .env file.
     */
    secrets?: Record<string, string | SecretRef>;
}

/** A credential read from the environment at call time instead of stored in the profile. */
export type SecretRef = { env: string };

// ─── Tool ─────────────────────────────────────────────────────────────────────

export type JSONSchema = Record<string, unknown>;

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: JSONSchema;
    /** Human-readable name for UIs and MCP clients. Default: none (clients fall back to `name`). */
    title?: string;
    /** Safe to run alongside other concurrencySafe tools in the same turn (read-only, order-independent). Default false. */
    concurrencySafe?: boolean;
    /**
     * Time limit for one call, in ms; takes precedence over the engine's `toolTimeoutMs`. When it expires
     * `ctx.signal` is aborted and the model gets a `TOOL_TIMEOUT` error. Default: none.
     */
    timeoutMs?: number;
    /**
     * The tool mutates nothing. Implies `concurrencySafe` and is incompatible with `destructive`.
     * Exposed to MCP clients as `readOnlyHint`. Default: unknown (the field is absent).
     */
    readOnly?: boolean;
    /**
     * Decides per call whether a person must approve it even in "approve all" mode (for example a command that
     * installs third-party code). Evaluated on the parsed arguments. Default: never.
     */
    alwaysAsk?: (args: Record<string, unknown>) => boolean;
    /**
     * The tool performs a write that cannot be undone from the outside (pay, delete, post, send).
     * A server that exposes such a tool directly must authorize every call (see `createToolServer`).
     * Exposed to MCP clients as `destructiveHint`.
     */
    destructive?: boolean;
    /** Calling it again with the same arguments has no additional effect. Exposed as `idempotentHint`. */
    idempotent?: boolean;
    /** Interacts with entities outside the system (the web, third parties). Exposed as `openWorldHint`. */
    openWorld?: boolean;
    /**
     * Free-form metadata for governance clients (autonomy level, ERP operation, version...). The engine never
     * reads it. Exposed to MCP clients as `_meta`, and read back from MCP servers only with `trustAnnotations`.
     */
    meta?: Record<string, unknown>;
    execute(args: unknown, ctx: ExecutionContext): Promise<string>;
}

// ─── Execution Context ────────────────────────────────────────────────────────

export interface ExecutionContext {
    /**
     * Aborted when the engine is aborted (`engine.abort()`, budget exceeded) or when the call's time
     * limit expires. Pass it to `fetch`, child processes and other cancellable work so they stop instead
     * of running on after the model has been told the call ended.
     */
    signal?: AbortSignal;
    agentId: string;
    sessionId: string;
    /**
     * Who is acting: this agent, its delegation chain and the engine's identity (tenant, user, roles...).
     * Set by the engine for every tool call (SPEC-0014).
     */
    principal?: import('../governance/types').Principal;
    /**
     * The policy allowed this call in `dry_run` mode: simulate and write nothing. A tool that writes and cannot
     * simulate must refuse (return an error) rather than write.
     */
    dryRun?: boolean;
    workingDir?: string;
    memory: SessionMemoryData;
    store?: ProjectStoreData;
    askAgent(agentId: string, question: string, context?: string): Promise<string>;
    /** Direct LLM call — single user prompt, returns text. Used by routing/compaction tools. */
    llmCall?(prompt: string): Promise<string>;
    /** Emit a compacting progress event to the display layer. */
    emitCompacting?(phase: 'start' | 'done' | 'fail', label: string): void;
    /** Advanced three-tier memory (episodic/semantic/procedural). Present when configured via createBaseEngine({ memorySystem }). */
    advancedMemory?: import('../agent-memory/MemorySystem').MemorySystem;
    /**
     * Shell binaries this agent is not allowed to run. Populated from the
     * agent profile's blockedCommands field. Enforced by run_command.
     */
    blockedCommands?: string[];
    /**
     * Extra directories (absolute paths) that file tools are allowed to access
     * beyond workingDir. Computed by AgentEngine from opts.additionalRoots plus
     * the project data directory (store.projectDir).
     */
    additionalRoots?: string[];
    /**
     * This agent's own credentials, from AgentProfile.secrets. Absent for
     * agents that don't declare any — a tool that needs one should check for
     * it explicitly and return a clear error rather than assume it's there.
     */
    secrets?: Record<string, string>;
    /**
     * Background jobs of this engine (present when `jobs` is enabled). A tool starts one with
     * `jobs.start({ kind, owner: ctx.agentId, run })` and returns its id instead of blocking.
     */
    jobs?: import('../jobs/JobRegistry').JobRegistry;
    /**
     * Confined execution (present when a sandbox is configured). A tool that runs something on the host
     * should go through `sandbox.run(...)` so the policy, backend and environment hygiene apply.
     */
    sandbox?: import('../sandbox/types').SandboxRunner;
}

export interface SessionMemoryData {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    getAll(): Record<string, string>;
}

/** Fields the agent can update in memory/session.md via the update_session tool. */
export interface SessionUpdates {
    /** Replace the Current Feature section — what is being worked on + progress */
    feature?: string;
    /** Append bullets to Decisions — key choices made (accumulates over time) */
    decisions?: string[];
    /** Replace Active Issues section — current blockers or open items */
    issues?: string[];
    /** Append bullets to Engine Learnings — non-obvious codebase discoveries (accumulates) */
    learnings?: string[];
    /** Replace Next Steps section — what needs to happen after this */
    next_steps?: string[];
}

export interface ProjectStoreData {
    /** Absolute path to the project memory directory (~/.{appName}/projects/{key}). Read-only. */
    readonly projectDir?: string;
    appendContext(content: string): void;
    appendLearning(content: string): void;
    saveAudit(agentId: string, content: string): void;
    getContext(): string;
    getLearnings(): string;
    /** Returns combined global + project agent-notes for a given agent id. */
    getAgentNotes?(agentId: string): string;
    listAudits(): string[];
    getLatestAudit(agentId: string): string | null;
    appendUserPreference(content: string): void;
    updateSession(updates: SessionUpdates): void;
}

// ─── LLM Provider ────────────────────────────────────────────────────────────

export interface ModelConfig {
    provider: 'deepseek' | 'openai' | 'anthropic' | string;
    id: string;
    apiKey?: string;
    baseUrl?: string;
    maxTokens?: number;
    temperature?: number;
}

export interface LLMMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: LLMToolCall[];
    tool_call_id?: string;
    /**
     * Opaque provider payload that must survive the history round trip, e.g. Anthropic assistant
     * blocks with `thinking` and their signature, which the API requires back intact while a
     * tool loop continues. Only the provider that produced it reads it; others must ignore it.
     */
    raw?: unknown;
}

/** Token usage beyond plain input/output, reported by providers with prompt caching. */
export interface LLMUsageDetails {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
}

export interface LLMToolCall {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
}

export interface LLMStreamCallbacks {
    onChunk?(delta: string): void;
    onToolCall?(name: string, args: string, id: string): void;
    onDone(message: LLMMessage): void;
    onError(err: Error): void;
    /** Optional — providers that know token usage should call this so cost tracking works. */
    onMetrics?(inputTokens: number, outputTokens: number, usage?: LLMUsageDetails): void;
    /** Optional — streamed reasoning ("thinking") text, for providers that expose it. */
    onReasoning?(delta: string): void;
    /**
     * Optional AbortSignal. Pass to the underlying HTTP request so that
     * AgentEngine.abort() cancels the in-flight stream immediately.
     * Providers that don't support it can safely ignore it.
     */
    signal?: AbortSignal;
    /**
     * Per-call model override. When set, the provider uses this model instead
     * of its configured default. Comes from AgentProfile.model.
     * Providers that don't support per-call model switching can ignore it.
     */
    model?: string;
}

/** Per-call options. Providers that do not know an option ignore it. */
export interface ChatOptions {
    /** Ask for a JSON answer matching `schema`. Validate the result anyway: not every provider enforces it. */
    responseFormat?: { type: 'json_schema'; name: string; schema: JSONSchema; strict?: boolean };
    /** Tool selection policy; only meaningful when tools are passed. */
    toolChoice?: 'auto' | 'none' | 'required' | { name: string };
}

/** How firmly a provider enforces `ChatOptions.responseFormat`. */
export type StructuredOutputSupport = 'native' | 'json_object' | 'none';

export interface LLMProvider {
    chat(messages: LLMMessage[], tools: ToolDefinition[], callbacks: LLMStreamCallbacks, options?: ChatOptions): Promise<void>;
    /**
     * `native`: the API enforces the schema. `json_object`: the API only guarantees valid JSON, so
     * the schema must also be in the prompt. `none` / absent: no guarantee.
     */
    capabilities?: { structuredOutput: StructuredOutputSupport };
    /** Default model this provider talks to; used to label traces when the agent profile sets no `model`. */
    readonly modelId?: string;
}

// ─── Events (transport-agnostic) ─────────────────────────────────────────────

export type ToolApprovalDecision = 'approve' | 'approve_all' | 'reject';

export type AgentEvent =
    | { type: 'ready' }
    | { type: 'token'; content: string; agent_id?: string }
    | { type: 'tool_call'; name: string; args_preview?: string }
    /** `agent_id`, `started_at` (epoch ms) and `duration_ms` let tracing build an accurate span per tool call. */
    | { type: 'tool_result'; name: string; success: boolean; preview?: string; agent_id?: string; started_at?: number; duration_ms?: number; outcome?: 'timeout' | 'aborted' }
    | { type: 'tool_approval_request'; tool_name: string; agent_id: string; args_preview: string }
    | { type: 'agent_switch'; from: string; to: string; to_name?: string; to_icon?: string }
    | { type: 'block_start'; agent_id: string; agent_name?: string; agent_icon?: string }
    | { type: 'block_end'; status: 'ok' | 'error'; agent_id?: string }
    | { type: 'thinking'; label: string }
    /**
     * Usage of one LLM call. `agent_id`, `provider`, `model`, `started_at` (epoch ms) and `duration_ms` are
     * present when the engine knows them and let tracing build an accurate `llm_call` span; `purpose` marks
     * calls that are not the agent's own turn (e.g. `context_summary`, `structured_output`).
     */
    | { type: 'metrics'; input_tokens: number; output_tokens: number; cost_usd?: number; cache_read_tokens?: number; cache_write_tokens?: number; agent_id?: string; provider?: string; model?: string; started_at?: number; duration_ms?: number; purpose?: string }
    | { type: 'done' }
    | { type: 'error'; message: string }
    | { type: 'system'; level: 'info' | 'warn' | 'error'; text: string }
    | { type: 'budget_exceeded'; usage: BudgetUsage }
    | { type: 'workflow_start'; name: string }
    | { type: 'workflow_step_start'; step: string; agent: string }
    | { type: 'workflow_step_complete'; step: string; success: boolean }
    | { type: 'workflow_approval_required'; step: string }
    | { type: 'workflow_complete'; name: string; status: 'completed' | 'failed' | 'rejected' }
    | { type: 'compacting'; label: string; phase: 'start' | 'done' | 'fail' }
    /**
     * A guardrail changed, blocked or failed on a piece of text. `replacement` (output phase only) is the
     * text that replaces what was already streamed, so a UI can swap it. `dry_run` events changed nothing.
     */
    /** A sandbox decision: the call was allowed, denied by policy, or could not be confined (nothing ran). */
    | { type: 'sandbox'; outcome: 'allowed' | 'SANDBOX_DENIED' | 'SANDBOX_UNAVAILABLE'; tool: string; agent_id: string; mode?: import('../sandbox/types').SandboxMode; network?: import('../sandbox/types').SandboxNetwork; backend?: string; reason?: string }
    | { type: 'guardrail'; name: string; phase: 'input' | 'tool_call' | 'tool_result' | 'output'; action: 'redact' | 'block' | 'error'; reason: string; agent_id?: string; tool?: string; dry_run?: boolean; replacement?: string };

// ─── Engine Options ───────────────────────────────────────────────────────────

import type { Skill } from '../skills/types';
import type { BudgetUsage } from '../observability/types';
import type { ContextOptions } from '../engine/ContextManager';
import type { Guardrail } from '../guardrails/types';
export type { Skill };

export interface EngineOptions {
    model: ModelConfig;
    maxIterations?: number;
    /**
     * Default time limit for one tool call, in ms (a tool's own `timeoutMs` wins). On expiry the call's
     * `ctx.signal` is aborted and the model receives `Error: TOOL_TIMEOUT …`; a result that arrives
     * later is discarded. Time spent waiting for approval does not count. Default: no limit.
     */
    toolTimeoutMs?: number;
    /**
     * Last resort for `AgentProfile.secrets` references whose environment variable is unset
     * (e.g. a vault lookup). Called on every tool call; returning nothing omits the secret.
     */
    secretResolver?: (name: string, agentId: string) => string | undefined | Promise<string | undefined>;
    /** Background job registry shared by the engine's tools (see BaseEngineOptions.jobs). */
    jobs?: import('../jobs/JobRegistry').JobRegistry;
    /** Confined execution: gives tools `ctx.sandbox`, refuses write tools in read-only and decides which tools ask for approval. */
    sandbox?: import('../sandbox/types').SandboxRunner;
    /** After a tool's signal is aborted, how long to wait for it to wind down before replying. Default 2000. */
    toolTimeoutGraceMs?: number;
    maxParallelAgents?: number;
    /** Deepest nesting of ask_agent delegations (agent → agent → …). Default 5. */
    maxDelegationDepth?: number;
    /**
     * Maximum number of messages to keep in the conversation history.
     * When exceeded, the oldest messages are dropped at the next user-turn boundary
     * to avoid orphaning tool call / tool result pairs.
     * Emits a 'system' warn event when trimming occurs.
     * Default: 200 (not applied when `context` is set, which replaces it). 0 disables the cap.
     *
     * Recommended: 100–200 for interactive agents; 40–60 for long-running autonomous agents.
     */
    maxContextMessages?: number;
    /**
     * Token-aware context control: truncates bulky old tool results, then folds the oldest turns into a
     * summary (or drops them) so the history stays under `context.maxTokens`. Checked before every LLM call.
     * Can be combined with `maxContextMessages`. Default: disabled.
     */
    context?: ContextOptions;
    /**
     * Checks on user input, tool arguments, tool results and model answers (see Guardrail). Applied to
     * the main agent and to every sub-agent. Default: none.
     */
    guardrails?: Guardrail[];
    /**
     * How `output` guardrails act on a streamed answer. `after` (default) keeps streaming and, when a
     * guardrail changes the answer, corrects the stored history and emits a `guardrail` event with the
     * `replacement`. `buffer` holds the tokens until the answer is checked: nothing unchecked is ever
     * shown, at the price of streaming.
     */
    guardrailOutputMode?: 'after' | 'buffer';
    workingDir?: string;
    sessionId?: string;
    /** Context injected into every agent system prompt (USER.md + AGENT.md + memory/contexto-proyecto.md + learnings.md + memory/session.md + audits/lecciones-aprendidas.md) */
    projectContext?: string;
    /** Persistent store for context, learnings, audits and logs */
    store?: ProjectStoreData;
    /**
     * Pre-loaded skills (builtins + any statically provided skills).
     * Injected into the system prompt per-run based on trigger + stack matching.
     */
    skills?: Skill[];
    /**
     * Stack identifiers detected from the project (e.g. ['node', 'typescript']).
     * Used as the language gate when activating pack skills.
     */
    detectedStack?: string[];
    /**
     * Called once on the first run() to load user YAML skills from disk
     * (global, packs and project layers). Results are merged with skills[].
     */
    loadSkills?: () => Promise<Skill[]>;
    /**
     * Path to a JSON file where conversation history is persisted between sessions.
     * On construction the engine loads the file into this.messages (non-system messages only).
     * After each run() the conversation is saved, capped at maxContextMessages (default 100).
     * Use engine.clearHistory() to wipe both in-memory and on-disk state.
     * When absent, conversation history is lost when the engine is destroyed.
     */
    historyPath?: string;
    /**
     * Number of recent messages from the orchestrator's conversation to inject
     * into each sub-agent call before the delegated question. Gives specialist
     * agents visibility into previous tool results (file reads, command outputs,
     * prior LLM responses) without requiring the orchestrator to copy-paste data.
     *
     * Sliced at a user-turn boundary to avoid orphaning tool call/result pairs.
     * Default: 0 (sub-agents only see their own question + explicit context).
     * Recommended: 10–20 for complex multi-turn tasks.
     */
    subAgentContextMessages?: number;
}
