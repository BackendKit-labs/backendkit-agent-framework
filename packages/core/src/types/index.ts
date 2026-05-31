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
    /** Where this agent was loaded from */
    source?: 'builtin' | 'global' | 'project' | 'registry' | 'mcp';
    /** Additional instructions appended to the base system prompt when this agent is active. */
    systemPromptAddition?: string;
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

export type JSONSchema = Record<string, unknown>;

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: JSONSchema;
    execute(args: unknown, ctx: ExecutionContext): Promise<string>;
}

// ─── Execution Context ────────────────────────────────────────────────────────

export interface ExecutionContext {
    agentId: string;
    sessionId: string;
    workingDir?: string;
    memory: SessionMemoryData;
    store?: ProjectStoreData;
    askAgent(agentId: string, question: string, context?: string): Promise<string>;
    /** Advanced three-tier memory (episodic/semantic/procedural). Present when configured via createBaseEngine({ memorySystem }). */
    advancedMemory?: import('../agent-memory/MemorySystem').MemorySystem;
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
    appendContext(content: string): void;
    appendLearning(content: string): void;
    saveAudit(agentId: string, content: string): void;
    getContext(): string;
    getLearnings(): string;
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
    onMetrics?(inputTokens: number, outputTokens: number): void;
}

export interface LLMProvider {
    chat(messages: LLMMessage[], tools: ToolDefinition[], callbacks: LLMStreamCallbacks): Promise<void>;
}

// ─── Events (transport-agnostic) ─────────────────────────────────────────────

export type ToolApprovalDecision = 'approve' | 'approve_all' | 'reject';

export type AgentEvent =
    | { type: 'ready' }
    | { type: 'token'; content: string; agent_id?: string }
    | { type: 'tool_call'; name: string; args_preview?: string }
    | { type: 'tool_result'; name: string; success: boolean; preview?: string }
    | { type: 'tool_approval_request'; tool_name: string; agent_id: string; args_preview: string }
    | { type: 'agent_switch'; from: string; to: string; to_name?: string; to_icon?: string }
    | { type: 'block_start'; agent_id: string; agent_name?: string; agent_icon?: string }
    | { type: 'block_end'; status: 'ok' | 'error'; agent_id?: string }
    | { type: 'thinking'; label: string }
    | { type: 'metrics'; input_tokens: number; output_tokens: number; cost_usd?: number }
    | { type: 'done' }
    | { type: 'error'; message: string }
    | { type: 'system'; level: 'info' | 'warn' | 'error'; text: string }
    | { type: 'workflow_start'; name: string }
    | { type: 'workflow_step_start'; step: string; agent: string }
    | { type: 'workflow_step_complete'; step: string; success: boolean }
    | { type: 'workflow_approval_required'; step: string }
    | { type: 'workflow_complete'; name: string; status: 'completed' | 'failed' | 'rejected' };

// ─── Engine Options ───────────────────────────────────────────────────────────

import type { Skill } from '../skills/types';
export type { Skill };

export interface EngineOptions {
    model: ModelConfig;
    maxIterations?: number;
    maxParallelAgents?: number;
    /**
     * Maximum number of messages to keep in the conversation history.
     * When exceeded, the oldest messages are dropped at the next user-turn boundary
     * to avoid orphaning tool call / tool result pairs.
     * Emits a 'system' warn event when trimming occurs.
     * Default: unlimited (undefined).
     *
     * Recommended: 100–200 for interactive agents; 40–60 for long-running autonomous agents.
     */
    maxContextMessages?: number;
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
