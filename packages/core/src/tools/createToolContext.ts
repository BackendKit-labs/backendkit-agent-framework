import type { ExecutionContext, SessionMemoryData } from '../types';

/** Everything in `ExecutionContext` is optional here; what is missing gets a safe default. */
export type ToolContextOptions = Partial<ExecutionContext>;

/** Session memory that lives only as long as the context object. */
export function createInMemorySessionMemory(): SessionMemoryData {
    const data = new Map<string, string>();
    return {
        get: key => data.get(key),
        set: (key, value) => { data.set(key, value); },
        getAll: () => Object.fromEntries(data),
    };
}

/**
 * Builds an `ExecutionContext` for running a tool outside an `AgentEngine`: tests, scripts, cron jobs and
 * the MCP tool server. Defaults: `agentId: 'direct'`, `sessionId: 'direct'`, in-memory session memory and an
 * `askAgent` that rejects (there is no engine to ask). Pass `signal` so the tool can be cancelled.
 *
 * @example
 * const out = await myTool.execute({ id: 7 }, createToolContext({ workingDir: process.cwd() }));
 */
export function createToolContext(opts: ToolContextOptions = {}): ExecutionContext {
    const { agentId, sessionId, memory, askAgent, ...rest } = opts;
    return {
        ...rest,
        agentId: agentId ?? 'direct',
        sessionId: sessionId ?? 'direct',
        memory: memory ?? createInMemorySessionMemory(),
        askAgent: askAgent ?? (async (target: string) => {
            throw new Error(`askAgent("${target}") is not available outside an AgentEngine`);
        }),
    };
}
