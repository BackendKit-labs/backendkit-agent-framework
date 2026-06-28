// ---------------------------------------------------------------------------
// Tool: get_notification_history
// ---------------------------------------------------------------------------

import { getHistory } from '../storage/history.js';

export async function handler(prompt: string): Promise<string> {
  // Extraer filtros del prompt
  const userIdMatch = prompt.match(/para (\S+)/);
  const channelMatch = prompt.match(/canal (\w+)/);
  const statusMatch = prompt.match(/status (\w+)/);

  const result = getHistory({
    userId: userIdMatch?.[1],
    channel: channelMatch?.[1],
    status: statusMatch?.[1] as any,
    limit: 50,
  });

  return JSON.stringify(result);
}
