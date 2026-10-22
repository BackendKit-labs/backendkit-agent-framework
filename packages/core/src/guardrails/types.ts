/**
 * Guardrails — checks on what enters and leaves the agent loop.
 *
 *  - `input`        the user message, before anything else sees it
 *  - `tool_call`    the arguments the model wants to send to a tool (before approval and execution)
 *  - `tool_result`  what a tool returned, before the model reads it (untrusted content, leaked data)
 *  - `output`       the model's own answer
 */
export type GuardrailPhase = 'input' | 'tool_call' | 'tool_result' | 'output';

export interface GuardrailContext {
    phase: GuardrailPhase;
    agentId: string;
    sessionId: string;
    /** The text under inspection (user input, JSON tool arguments, tool result or model answer). */
    content: string;
    /** Set for `tool_call` and `tool_result`. */
    toolName?: string;
    /** Secrets of the agent in play (`AgentProfile.secrets`). */
    secrets?: Record<string, string>;
    /** Every secret value of every registered agent, so one agent cannot leak another's credential. */
    secretValues: string[];
}

export type GuardrailDecision =
    | { action: 'allow' }
    /** Continue with `content` instead of the original text. */
    | { action: 'redact'; content: string; reason: string }
    /** Stop: the text is not delivered. */
    | { action: 'block'; reason: string };

export interface Guardrail {
    name: string;
    phases: GuardrailPhase[];
    check(ctx: GuardrailContext): GuardrailDecision | Promise<GuardrailDecision>;
    /**
     * What happens when `check` throws. `closed` (default) treats it as a block, `open` lets the text
     * through and only reports the error.
     */
    failMode?: 'open' | 'closed';
    /** Report what would happen (`guardrail` events) without changing or blocking anything. */
    dryRun?: boolean;
}

/** Engine-level outcome of running every guardrail of a phase. */
export interface GuardrailOutcome {
    content: string;
    changed: boolean;
    blocked?: { guardrail: string; reason: string };
    /** Every redaction, block and error that happened, in order (dry-run ones included). */
    events: GuardrailEventInfo[];
}

export type GuardrailAction = 'redact' | 'block' | 'error';

export interface GuardrailEventInfo {
    name: string;
    phase: GuardrailPhase;
    action: GuardrailAction;
    reason: string;
    agentId: string;
    tool?: string;
    dryRun: boolean;
}
