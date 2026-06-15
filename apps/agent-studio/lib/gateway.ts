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

export interface FlowStep {
    id:             string;
    agent:          string;
    task:           string;
    capability?:    string;
    depends_on?:    string[];
    gate?:          boolean;
    gate_criteria?: string[];
    require?:       boolean;
}

export interface FlowConfig {
    id:          string;
    file:        string;
    trigger:     string;
    name?:       string;
    description?: string;
    steps:       FlowStep[];
    error?:      string;
}

export interface AgentConfig {
    id:             string;
    description:    string;
    strategy:       string;
    capability?:    string;
    timeout?:       number;
    gate?:          boolean;
    gate_criteria?: string[];
    instances:      { url: string; apiKey?: string }[];
}

export interface OrchestratorConfig {
    orchestrator: { name: string; data_dir: string };
    agents:       AgentConfig[];
    flows:        FlowConfig[];
    settings:     { maxConcurrentFlows: number };
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

export async function getConfig(): Promise<OrchestratorConfig | null> {
    try {
        const res = await fetch(`${GATEWAY_URL}/api/config`, { cache: 'no-store' });
        if (!res.ok) return null;
        return res.json() as Promise<OrchestratorConfig>;
    } catch { return null; }
}

// ── Config CRUD (client-side — calls gateway which proxies to orchestrator) ───

export async function saveAgent(agent: AgentConfig): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch('/api/config/agents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(agent),
    });
    return res.json() as Promise<{ ok: boolean; error?: string }>;
}

export async function deleteAgent(id: string): Promise<{ ok: boolean }> {
    const res = await fetch(`/api/config/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return res.json() as Promise<{ ok: boolean }>;
}

export async function saveFlow(flow: FlowConfig): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch('/api/config/flows', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(flow),
    });
    return res.json() as Promise<{ ok: boolean; error?: string }>;
}

export async function deleteFlow(id: string): Promise<{ ok: boolean }> {
    const res = await fetch(`/api/config/flows/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return res.json() as Promise<{ ok: boolean }>;
}
