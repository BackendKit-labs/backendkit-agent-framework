// Client for director-api REST endpoints

const DIRECTOR_BASE = '/api/director';

function apiKey(): Record<string, string> {
  const key = process.env.NEXT_PUBLIC_DIRECTOR_API_KEY;
  return key ? { 'X-Api-Key': key } : {};
}

async function directorFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${DIRECTOR_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...apiKey(),
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface WorkflowStep {
  id: string;
  workflowId: string;
  order: number;
  deployableId: string | null;
  config: Record<string, unknown> | null;
  deployable?: { id: string; name: string; type: string };
}

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'paused';
  trigger: 'manual' | 'webhook' | 'scheduled';
  departmentId: string | null;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
}

export interface Deployable {
  id: string;
  name: string;
  type: string;
  description: string | null;
  version: string | null;
  status: string;
}

// ── Workflows ──────────────────────────────────────────────────────────────

export function listWorkflows(): Promise<Workflow[]> {
  return directorFetch<Workflow[]>('/workflows');
}

export function getWorkflow(id: string): Promise<Workflow> {
  return directorFetch<Workflow>(`/workflows/${id}`);
}

export function createWorkflow(data: {
  name: string;
  description?: string;
  trigger?: Workflow['trigger'];
  steps?: Array<{ order: number; deployableId?: string; config?: Record<string, unknown> }>;
}): Promise<Workflow> {
  return directorFetch<Workflow>('/workflows', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateWorkflow(
  id: string,
  data: Partial<{
    name: string;
    description: string;
    status: Workflow['status'];
    trigger: Workflow['trigger'];
    steps: Array<{ order: number; deployableId?: string; config?: Record<string, unknown> }>;
  }>,
): Promise<Workflow> {
  return directorFetch<Workflow>(`/workflows/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteWorkflow(id: string): Promise<void> {
  return directorFetch<void>(`/workflows/${id}`, { method: 'DELETE' });
}

export function runWorkflow(id: string, input?: Record<string, unknown>): Promise<{ runId: string }> {
  return directorFetch<{ runId: string }>(`/workflows/${id}/run`, {
    method: 'POST',
    body: JSON.stringify({ input: input ?? {} }),
  });
}

// ── Deployables ────────────────────────────────────────────────────────────

export function listDeployables(): Promise<Deployable[]> {
  return directorFetch<Deployable[]>('/deployables');
}
