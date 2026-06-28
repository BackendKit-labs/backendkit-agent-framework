// ---------------------------------------------------------------------------
// Check: End-to-End — integración con el orquestador BackendKit
// ---------------------------------------------------------------------------

import { fetchWithTimeout } from '../fetch.js';

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:3000';
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 30_000;

interface E2EResult {
  success: boolean;
  flow_id: string;
  run_id: string;
  duration_ms: number;
  steps_completed: number;
  error?: string;
}

async function createTestFlow(flowId: string): Promise<boolean> {
  try {
    const body = {
      id: flowId,
      name: flowId,
      description: 'Health check test flow - creado por health-checker',
      steps: [
        {
          id: 'echo-ok',
          type: 'echo',
          message: 'Health check OK',
        },
      ],
    };
    const res = await fetchWithTimeout(`${ORCHESTRATOR_URL}/flows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function executeFlow(flowId: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`${ORCHESTRATOR_URL}/flows/${flowId}/run`, {
      method: 'POST',
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.run_id || data.id || null;
  } catch {
    return null;
  }
}

async function pollRunResult(runId: string): Promise<{ status: string; steps_completed: number } | null> {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    try {
      const res = await fetchWithTimeout(`${ORCHESTRATOR_URL}/runs/${runId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'completed' || data.status === 'success') {
          return { status: 'completed', steps_completed: data.steps_completed || data.steps || 1 };
        }
        if (data.status === 'failed' || data.status === 'error') {
          return { status: 'failed', steps_completed: data.steps_completed || 0 };
        }
      }
    } catch {
      // Si el orquestador falla temporalmente, seguir intentando
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return null; // timeout
}

async function cleanupFlow(flowId: string): Promise<void> {
  try {
    await fetchWithTimeout(`${ORCHESTRATOR_URL}/flows/${flowId}`, {
      method: 'DELETE',
    });
  } catch {
    // Si no se puede limpiar, no es crítico
  }
}

export async function runEndToEndTest(flowId?: string): Promise<E2EResult> {
  const targetFlowId = flowId || 'health-check-test';
  const startTime = Date.now();

  // 1. Crear flow si no se especificó uno
  if (!flowId) {
    const created = await createTestFlow(targetFlowId);
    if (!created) {
      return {
        success: false,
        flow_id: targetFlowId,
        run_id: '',
        duration_ms: Date.now() - startTime,
        steps_completed: 0,
        error: `No se pudo crear el flow de prueba '${targetFlowId}' - ¿El orquestador está corriendo?`,
      };
    }
  }

  // 2. Ejecutar el flow
  const runId = await executeFlow(targetFlowId);
  if (!runId) {
    // Limpiar si creamos el flow
    if (!flowId) await cleanupFlow(targetFlowId);
    return {
      success: false,
      flow_id: targetFlowId,
      run_id: '',
      duration_ms: Date.now() - startTime,
      steps_completed: 0,
      error: `No se pudo ejecutar el flow '${targetFlowId}' - ¿El orquestador está corriendo?`,
    };
  }

  // 3. Esperar resultado
  const result = await pollRunResult(runId);
  const duration = Date.now() - startTime;

  if (!result) {
    // Timeout - limpiar si creamos el flow
    if (!flowId) await cleanupFlow(targetFlowId);
    return {
      success: false,
      flow_id: targetFlowId,
      run_id: runId,
      duration_ms: duration,
      steps_completed: 0,
      error: `Timeout esperando resultado del run ${runId} (límite: ${POLL_TIMEOUT_MS}ms)`,
    };
  }

  // 4. Limpiar solo si creamos el flow
  if (!flowId) {
    await cleanupFlow(targetFlowId);
  }

  return {
    success: result.status === 'completed',
    flow_id: targetFlowId,
    run_id: runId,
    duration_ms: duration,
    steps_completed: result.steps_completed,
    error: result.status === 'failed' ? `El flow '${targetFlowId}' falló durante la ejecución` : undefined,
  };
}
