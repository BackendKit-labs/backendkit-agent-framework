// Client for abac-service REST endpoints (via gateway proxy)

const ABAC_BASE = '/api/abac';

async function abacFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ABAC_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DepartmentResource {
  id: string;
  department: string;
  uriPattern: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
}

// ── Resources API ─────────────────────────────────────────────────────────────

export function listDepartmentResources(department?: string): Promise<DepartmentResource[]> {
  const qs = department ? `?department=${encodeURIComponent(department)}` : '';
  return abacFetch<DepartmentResource[]>(`/resources/department${qs}`);
}

export function addDepartmentResource(
  department: string,
  uriPattern: string,
  description?: string,
): Promise<DepartmentResource> {
  return abacFetch<DepartmentResource>('/resources/department', {
    method: 'POST',
    body: JSON.stringify({ department, uriPattern, description }),
  });
}

export function removeDepartmentResource(id: string): Promise<void> {
  return abacFetch<void>(`/resources/department/${id}`, { method: 'DELETE' });
}

export function getAllowedPatterns(): Promise<{ patterns: string[] }> {
  return abacFetch<{ patterns: string[] }>('/resources/allowed');
}
