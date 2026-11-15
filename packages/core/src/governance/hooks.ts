import type { AgentEvent, AgentProfile } from '../types';
import type { Principal, ToolCall } from './types';

/**
 * What every hook of one turn (`engine.run(input)`) shares. `state` lives for the turn: a `beforeRun` hook can
 * put a classification there and a `systemPrompt` or `afterTurn` hook read it back.
 */
export interface RunContext {
    /** The principal of the turn (the active agent). Tool hooks receive the principal of the agent making the call. */
    principal: Principal;
    input: string;
    state: Map<string, unknown>;
    /** Whether an agent with this id is registered in the engine. */
    hasAgent(agentId: string): boolean;
    /** Aborted when the engine is aborted. */
    signal: AbortSignal;
    emit(event: AgentEvent): void;
}

/** What `afterTurn` may ask for: another pass, optionally as another agent and with a message for it. */
export interface ContinueTurn {
    action: 'continue';
    /** Agent that takes the next pass. Default: the same agent. */
    agentId?: string;
    /** Added to the conversation as a user message before the next pass. */
    message?: string;
}

/**
 * Points where a vertical hooks into the engine without new engine options (SPEC-0014 §3). Hooks of the same point
 * run in registration order. An error thrown by a hook fails the turn (fail-closed), like a failing orchestrator.
 */
export interface EngineHooks {
    /** Name used in error messages. */
    name?: string;
    /** Before the turn starts, after input guardrails. */
    beforeRun?(ctx: RunContext): void | Promise<void>;
    /** A section appended to the system prompt of `profile` (the active agent or a delegate), in registration order. */
    systemPrompt?(ctx: RunContext, profile: AgentProfile): string | undefined | Promise<string | undefined>;
    /**
     * The model answered without asking for tools. Return `{ action: 'continue' }` to force another pass, for
     * example as a reviewing agent. Capped per turn (see `maxHookContinues`), and every pass counts against
     * `maxIterations`. The first hook that asks to continue wins.
     */
    afterTurn?(ctx: RunContext, turn: { text: string; profile: AgentProfile }): void | ContinueTurn | Promise<void | ContinueTurn>;
    /** A call the policy allowed is about to run. */
    beforeTool?(ctx: RunContext, call: ToolCall): void | Promise<void>;
    /** A call ran (successfully or not). */
    afterTool?(ctx: RunContext, call: ToolCall, result: { text: string; success: boolean }): void | Promise<void>;
    /** The turn is over. `text` is the last answer of the model. */
    afterRun?(ctx: RunContext, result: { text: string }): void | Promise<void>;
}

/** Default cap of `continue` passes requested by `afterTurn` hooks in one turn (same as the QA rework cap). */
export const DEFAULT_MAX_HOOK_CONTINUES = 5;

/** Runs `fn` for every hook that defines `point`, in order; a throw becomes an error naming the hook and point. */
export async function runHooks<T>(
    hooks: EngineHooks[], point: keyof EngineHooks, fn: (hook: EngineHooks) => T | Promise<T> | undefined,
): Promise<T[]> {
    const out: T[] = [];
    for (let i = 0; i < hooks.length; i++) {
        const hook = hooks[i];
        if (typeof hook[point] !== 'function') continue;
        try {
            const value = await fn(hook);
            if (value !== undefined) out.push(value as T);
        } catch (err) {
            const name = hook.name ?? `#${i}`;
            throw new Error(`Hook ${name} failed in ${String(point)}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    return out;
}
