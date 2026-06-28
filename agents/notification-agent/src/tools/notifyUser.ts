// ---------------------------------------------------------------------------
// Tool: notify_user
// ---------------------------------------------------------------------------

import { notifyUser } from '../services/notifyUser.js';

export async function handler(prompt: string): Promise<string> {
  const userIdMatch = prompt.match(/para (\S+) de empresa (\S+)/);
  const userId = userIdMatch?.[1] || 'unknown';
  const companyId = userIdMatch?.[2] || 'unknown';
  const titleMatch = prompt.match(/:\s*(.+)/);
  const title = titleMatch?.[1] || 'Notificación';

  const result = await notifyUser({
    userId,
    companyId,
    title,
    body: title,
    context: { type: 'sistema' },
    priority: 'normal',
    source: 'notification-agent',
  });

  return JSON.stringify(result);
}
