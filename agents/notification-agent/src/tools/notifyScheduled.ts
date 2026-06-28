// ---------------------------------------------------------------------------
// Tool: notify_scheduled — programa notificación para futuro
// ---------------------------------------------------------------------------

import { scheduleNotification } from '../storage/scheduled.js';
import { scheduleTask } from '../services/schedulerClient.js';

export async function handler(prompt: string): Promise<string> {
  const userIdMatch = prompt.match(/para (\S+) en (\S+)/);
  const userId = userIdMatch?.[1] || 'unknown';
  const scheduleAt = userIdMatch?.[2] || new Date(Date.now() + 3600000).toISOString();

  // 1. Guardar localmente (respaldo)
  const local = scheduleNotification({
    userId,
    companyId: 'default',
    title: 'Notificación programada',
    body: 'Cuerpo de la notificación',
    context: { type: 'sistema' },
    scheduleAt,
    source: 'notification-agent',
  });

  // 2. Registrar en scheduler-agent (primario)
  // Si el scheduler no está disponible, la notificación queda en scheduled.json
  const schedulerResult = await scheduleTask({
    type: 'one_time',
    when: scheduleAt,
    workflow: 'notification-agent:notify_user',
    workflowInput: {
      userId,
      companyId: 'default',
      title: 'Notificación programada',
      body: 'Cuerpo de la notificación',
      context: { type: 'sistema' },
      priority: 'normal',
      source: 'notification-agent',
    },
  });

  return JSON.stringify({
    id: local.id,
    scheduledAt: local.scheduleAt,
    status: 'scheduled',
    schedulerTaskId: schedulerResult?.id || null,
  });
}
