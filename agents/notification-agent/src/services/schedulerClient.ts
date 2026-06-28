// ---------------------------------------------------------------------------
// Scheduler Client — comunicación con el Scheduler-Agent del ecosistema
// ---------------------------------------------------------------------------

const SCHEDULER_URL = process.env.SCHEDULER_URL || 'http://localhost:3100';

export interface ScheduleTaskParams {
  type: 'one_time' | 'cron'
  when?: string
  cron?: string
  timezone?: string
  workflow: string
  workflowInput: Record<string, any>
}

export interface ScheduleTaskResult {
  id: string
  status: string
  nextRunAt: string
}

/**
 * Programa una tarea en el Scheduler-Agent.
 * Si el scheduler no está disponible, retorna null (la notificación
 * queda en scheduled.json como respaldo local).
 */
export async function scheduleTask(params: ScheduleTaskParams): Promise<ScheduleTaskResult | null> {
  try {
    const response = await fetch(`${SCHEDULER_URL}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;
    return await response.json();
  } catch {
    // Scheduler no disponible — la notificación queda en scheduled.json
    return null;
  }
}
