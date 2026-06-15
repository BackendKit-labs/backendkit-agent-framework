const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://localhost:3400';

// ── Shared types ──────────────────────────────────────────────────────────────

export type RunStatus =
    | 'running'
    | 'waiting_gate'
    | 'waiting_retry'
    | 'done'
    | 'failed'
    | 'cancelled';

export interface StepResult {
    stepId:     string;
    agentId:    string;
    capability: string;
    task?:      string;
    output:     string;
    success:    boolean;
    durationMs: number;
}

export interface RunState {
    id:             string;
    flowId:         string;
    status:         RunStatus;
    input:          Record<string, unknown>;
    results:        StepResult[];
    currentStepId?: string;
    gateStepId?:    string;
    gateCriteria?:  string[];
    failedStepId?:  string;
    summary?:       string;
    error?:         string;
    createdAt:      string;
    updatedAt:      string;
}

export interface AgentInstance {
    url:          string;
    ok:           boolean;
    circuitState: string;
}

export interface AgentHealth {
    id:          string;
    description: string;
    strategy:    string;
    instances:   AgentInstance[];
}

// ── API calls (server-side only) ──────────────────────────────────────────────

export async function listRuns(): Promise<RunState[]> {
    try {
        const res = await fetch(`${GATEWAY_URL}/api/runs`, { cache: 'no-store' });
        if (!res.ok) return [];
        return res.json() as Promise<RunState[]>;
    } catch { return []; }
}

export async function approveRun(runId: string, feedback?: string): Promise<unknown> {
    const res = await fetch(`${GATEWAY_URL}/api/approve`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ run_id: runId, ...(feedback ? { feedback } : {}) }),
    });
    return res.json();
}

export async function rejectRun(runId: string, reason?: string): Promise<unknown> {
    const res = await fetch(`${GATEWAY_URL}/api/reject`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ run_id: runId, ...(reason ? { reason } : {}) }),
    });
    return res.json();
}

export async function retryRun(runId: string, feedback?: string): Promise<unknown> {
    const res = await fetch(`${GATEWAY_URL}/api/retry`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ run_id: runId, ...(feedback ? { feedback } : {}) }),
    });
    return res.json();
}

export async function listAgents(): Promise<AgentHealth[]> {
    try {
        const res = await fetch(`${GATEWAY_URL}/api/agents`, { cache: 'no-store' });
        if (!res.ok) return [];
        return res.json() as Promise<AgentHealth[]>;
    } catch { return []; }
}
