/**
 * Confinement of what an agent runs. Core only defines the contract; the implementation
 * (policy, backends, environment hygiene) lives in `@backendkit-labs/agent-sandbox`.
 */

/** How much of the host a call may touch. */
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export type SandboxNetwork = 'none' | 'allow';

/** What a tool asks the sandbox to run. */
export interface SandboxExecRequest {
    /** Name of the tool asking, e.g. `run_command`. Policies can key on it. */
    tool: string;
    /** Shell command line, portable (what a container runs). */
    command: string;
    /** The same command adjusted for the host shell (e.g. Windows equivalents); used by backends that run on the host. Default: `command`. */
    hostCommand?: string;
    /** Directory to run in. */
    cwd: string;
    /** Root the sandbox may expose (mounted by container backends). Default: `cwd`. */
    workspace?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    /** Called with stdout and stderr interleaved, in arrival order, while the command runs. */
    onOutput?: (chunk: string) => void;
}

export interface SandboxExecResult {
    /** Exit status; `null` when the process was killed by a signal. */
    exitCode: number | null;
    /** stdout and stderr interleaved in arrival order (capped by the backend). */
    output: string;
    timedOut: boolean;
    aborted: boolean;
    /** The process could not be started / failed before running (message). */
    error?: string;
}

/** Who is asking. */
export interface SandboxCaller {
    agentId: string;
    sessionId: string;
}

export type SandboxDenyCode =
    /** The policy does not allow this call. */
    | 'SANDBOX_DENIED'
    /** The mode the policy requires cannot be enforced on this host: nothing was run. */
    | 'SANDBOX_UNAVAILABLE';

/** The service never throws for policy reasons and never answers with a bare string. */
export type SandboxOutcome =
    | { ok: true; result: SandboxExecResult; mode: SandboxMode; network: SandboxNetwork; backend: string }
    | { ok: false; code: SandboxDenyCode; reason: string; mode: SandboxMode; network: SandboxNetwork; backend?: string };

/** What every decision looks like to observers (audit log, control plane, tests). */
export interface SandboxDecision {
    at: number;
    agentId: string;
    sessionId: string;
    tool: string;
    mode: SandboxMode;
    network: SandboxNetwork;
    backend?: string;
    /** `allowed` or the deny code. */
    outcome: 'allowed' | SandboxDenyCode;
    reason?: string;
}

/** `ExecutionContext.sandbox`: the single place tools go through to run something confined. */
export interface SandboxRunner {
    run(caller: SandboxCaller, request: SandboxExecRequest): Promise<SandboxOutcome>;
    /**
     * Is `tool` allowed at all for this caller under the current policy? Lets the engine refuse tools
     * that write (in `read-only`) before they run. Never depends on the approval gate.
     */
    authorizeTool?(caller: SandboxCaller, tool: string): { ok: true } | { ok: false; code: SandboxDenyCode; reason: string };
    /**
     * Does this tool need a human under the current policy? When present it REPLACES the engine's built-in
     * list of tools that ask (write_file, edit_file, run_command). `ask` with no approver configured is
     * refused (fail closed): an unattended flow or trigger can never end up running what nobody approved.
     */
    approvalFor?(caller: SandboxCaller, tool: string): 'none' | 'ask';
    /**
     * Observe every decision (allowed, denied, unavailable) taken by this runner, whoever asked. Returns the
     * unsubscribe function. The engine does NOT use this: a runner can be shared by several engines and each
     * one reports only the decisions of its own calls.
     */
    onDecision?(listener: (decision: SandboxDecision) => void): () => void;
}
