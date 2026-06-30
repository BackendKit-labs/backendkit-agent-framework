export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflow?: { id: string; name: string };
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

function authHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = sessionStorage.getItem('director_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function directorFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/director${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(),
      ...init?.headers,
    },
  });
  if (res.status === 401) {
    sessionStorage.clear();
    window.location.href = '/login';
    throw new Error('Sesión expirada');
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export function getAllRuns(limit = 100): Promise<WorkflowRun[]> {
  return directorFetch<WorkflowRun[]>(`/workflows/runs?limit=${limit}`);
}
