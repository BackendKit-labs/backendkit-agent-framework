/**
 * The contract between Hermes and any agent it supervises. A connector hides HOW an agent is reached (HTTP with
 * agent-protocol, in the same process, later MCP or ACP); Hermes only ever sees this.
 */

export type RunStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface CapabilityInfo {
    name: string;
    description: string;
    /** Takes long: the connector starts it and reports progress instead of answering at once. */
    async: boolean;
    input?: unknown;
}

export interface AgentDescriptor {
    name: string;
    version?: string;
    description?: string;
    capabilities: CapabilityInfo[];
}

export type HealthState = 'ok' | 'degraded' | 'down';

export interface HealthReport {
    state: HealthState;
    latencyMs?: number;
    detail?: string;
}

export interface ConnectorRunRequest {
    capability: string;
    input: Record<string, unknown>;
    /** Wait for the answer in the same call when the capability is quick; otherwise the connector starts it in the background. */
    async?: boolean;
}

export interface ConnectorRunContext {
    traceId?: string;
    tenantId?: string;
    /** Stops waiting and, where the agent allows it, the run. */
    signal?: AbortSignal;
}

export interface RunOutcome {
    status: Exclude<RunStatus, 'pending' | 'running'>;
    output?: unknown;
    error?: string;
}

/** A started run. `result()` settles when the run ends; it never rejects for a failed run (it resolves with `status: 'failed'`). */
export interface RunHandle {
    /** Where the agent knows this run by. Stored so a restarted Hermes can ask about it again. */
    readonly connectorRunId: string;
    result(): Promise<RunOutcome>;
    status(): Promise<RunStatus>;
    cancel(reason?: string): Promise<void>;
}

/** The answer of an agent about a run Hermes started earlier. `unknown` = the agent has no such run. */
export type RunLookup = { found: true; status: RunStatus; output?: unknown; error?: string } | { found: false };

/** One line of an agent's own audit trail (its sandbox and control decisions). */
export interface AgentAuditEntry { ts: string; [key: string]: unknown }

/**
 * What a supervised agent lets Hermes do to its execution: read and set the sandbox policy, see and cancel its background
 * jobs, read its audit trail. Every call is a control-channel call: it needs the agent's own control key, not the run key.
 * Errors carry the protocol `code` (`APPROVAL_REQUIRED`, `POLICY_WIDER_THAN_PARENT`, `CONTROL_UNSUPPORTED`, ...).
 */
export interface AgentControlPort {
    /** Control actions the agent implements (e.g. `set_sandbox_policy`). */
    readonly actions: readonly string[];
    call(action: string, params: Record<string, unknown>): Promise<unknown>;
    /** Absent when the agent publishes no audit trail. */
    audit?(query: { since?: string; limit?: number }): Promise<AgentAuditEntry[]>;
}

export interface AgentConnector {
    readonly kind: 'protocol' | 'in-process';
    /** Releases what the connector holds (processes, sockets) when its agent leaves the fleet. */
    close?(): Promise<void>;
    /** The control channel, when the connector has one configured. */
    control?(): AgentControlPort | undefined;
    describe(): Promise<AgentDescriptor>;
    /** Never rejects: an unreachable agent is `{ state: 'down' }`. */
    health(signal?: AbortSignal): Promise<HealthReport>;
    run(request: ConnectorRunRequest, context?: ConnectorRunContext): Promise<RunHandle>;
    /**
     * Asks the agent about a run Hermes started before (after a restart). Absent for connectors whose runs cannot
     * outlive Hermes (in-process): those runs are lost with it. Rejects when the agent cannot be reached, which is
     * different from `{ found: false }`.
     */
    lookup?(connectorRunId: string): Promise<RunLookup>;
    /** Cancels a run known only by its connector id (after a restart). */
    cancel?(connectorRunId: string): Promise<void>;
    /** A handle on a run found by `lookup` that is still going, so Hermes can wait for it as for any other. */
    follow?(connectorRunId: string, signal?: AbortSignal): RunHandle;
}
