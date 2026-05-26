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
    source?: 'builtin' | 'global' | 'project';
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
}

export interface SessionMemoryData {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    getAll(): Record<string, string>;
}

export interface ProjectStoreData {
    appendContext(content: string): void;
    appendLearning(content: string): void;
    appendLog(entry: string): void;
    saveAudit(agentId: string, content: string): void;
    getContext(): string;
    getLearnings(): string;
    getLog(lines?: number): string;
    listAudits(): string[];
    getLatestAudit(agentId: string): string | null;
    appendUserPreference(content: string): void;
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
}

export interface LLMProvider {
    chat(messages: LLMMessage[], tools: ToolDefinition[], callbacks: LLMStreamCallbacks): Promise<void>;
}

// ─── Events (transport-agnostic) ─────────────────────────────────────────────

export type AgentEvent =
    | { type: 'ready' }
    | { type: 'token'; content: string }
    | { type: 'tool_call'; name: string; args_preview?: string }
    | { type: 'tool_result'; name: string; success: boolean; preview?: string }
    | { type: 'agent_switch'; from: string; to: string; to_name?: string; to_icon?: string }
    | { type: 'block_start'; agent_id: string; agent_name?: string; agent_icon?: string }
    | { type: 'block_end'; status: 'ok' | 'error'; agent_id?: string }
    | { type: 'thinking'; label: string }
    | { type: 'metrics'; input_tokens: number; output_tokens: number; cost_usd?: number }
    | { type: 'done' }
    | { type: 'error'; message: string }
    | { type: 'system'; level: 'info' | 'warn' | 'error'; text: string };

// ─── Engine Options ───────────────────────────────────────────────────────────

export interface EngineOptions {
    model: ModelConfig;
    maxIterations?: number;
    maxParallelAgents?: number;
    workingDir?: string;
    sessionId?: string;
    /** Context injected into the orchestrator system prompt (USER.md + AGENT.md + context.md + learnings.md) */
    projectContext?: string;
    /** Persistent store for context, learnings, audits and logs */
    store?: ProjectStoreData;
}
