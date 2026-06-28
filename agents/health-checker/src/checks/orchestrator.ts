// ---------------------------------------------------------------------------
// Check: Orchestrator — comunicación HTTP con el orquestador BackendKit
// ---------------------------------------------------------------------------

import { getCached, setCache } from '../cache.js';
import { fetchWithTimeout } from '../fetch.js';

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:3000';

// ---------------------------------------------------------------------------
// Ping al orquestador → status + latencia
// ---------------------------------------------------------------------------

export async function pingOrchestrator(): Promise<{ status: 'up' | 'down'; latency_ms: number }> {
  const cached = getCached<{ status: 'up' | 'down'; latency_ms: number }>('orchestrator-ping');
  if (cached) return cached;

  const start = Date.now();
  try {
    const res = await fetchWithTimeout(`${ORCHESTRATOR_URL}/health`);
    const latency = Date.now() - start;
    const result = { status: res.ok ? ('up' as const) : ('down' as const), latency_ms: latency };
    setCache('orchestrator-ping', result);
    return result;
  } catch {
    const result = { status: 'down' as const, latency_ms: Date.now() - start };
    setCache('orchestrator-ping', result);
    return result;
  }
}

// ---------------------------------------------------------------------------
// Listar agentes registrados
// ---------------------------------------------------------------------------

export async function listAgents(): Promise<{ total: number; alive: number; dead: string[]; unregistered: number }> {
  const cached = getCached<{ total: number; alive: number; dead: string[]; unregistered: number }>('orchestrator-agents');
  if (cached) return cached;

  try {
    const res = await fetchWithTimeout(`${ORCHESTRATOR_URL}/agents`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Asumimos que el orquestador devuelve { agents: [{ id, status, ... }] }
    const agents = data.agents || data || [];
    const alive = agents.filter((a: any) => a.status === 'up' || a.status === 'alive').length;
    const dead = agents.filter((a: any) => a.status === 'down' || a.status === 'dead').map((a: any) => a.id || a.agent_id);
    const result = { total: agents.length, alive, dead, unregistered: 0 };
    setCache('orchestrator-agents', result);
    return result;
  } catch {
    const result = { total: 0, alive: 0, dead: [], unregistered: 0 };
    setCache('orchestrator-agents', result);
    return result;
  }
}

// ---------------------------------------------------------------------------
// Obtener endpoint de un agente específico
// ---------------------------------------------------------------------------

export async function getAgentEndpoint(agentId: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`${ORCHESTRATOR_URL}/agents/${agentId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.endpoint || data.url || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hacer ping a un agente específico
// ---------------------------------------------------------------------------

export async function pingAgent(agentId: string): Promise<{ status: 'up' | 'down' | 'unknown'; latency_ms: number; last_seen?: string }> {
  try {
    const endpoint = await getAgentEndpoint(agentId);
    if (!endpoint) {
      return { status: 'unknown', latency_ms: 0 };
    }

    const start = Date.now();
    const res = await fetchWithTimeout(endpoint);
    const latency = Date.now() - start;

    return {
      status: res.ok ? 'up' : 'down',
      latency_ms: latency,
      last_seen: new Date().toISOString(),
    };
  } catch {
    return { status: 'down', latency_ms: 0, last_seen: undefined };
  }
}

// ---------------------------------------------------------------------------
// Listar runs activos
// ---------------------------------------------------------------------------

export async function listRuns(): Promise<{ configured: number; active_runs: number; failed_last_hour: number }> {
  const cached = getCached<{ configured: number; active_runs: number; failed_last_hour: number }>('orchestrator-runs');
  if (cached) return cached;

  try {
    const res = await fetchWithTimeout(`${ORCHESTRATOR_URL}/runs`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const runs = data.runs || data || [];
    const active = runs.filter((r: any) => r.status === 'running' || r.status === 'active').length;
    const oneHourAgo = Date.now() - 3600000;
    const failed = runs.filter((r: any) => (r.status === 'failed' || r.status === 'error') && new Date(r.updatedAt || r.createdAt).getTime() > oneHourAgo).length;
    const result = { configured: runs.length, active_runs: active, failed_last_hour: failed };
    setCache('orchestrator-runs', result);
    return result;
  } catch {
    const result = { configured: 0, active_runs: 0, failed_last_hour: 0 };
    setCache('orchestrator-runs', result);
    return result;
  }
}
