// ---------------------------------------------------------------------------
// get_current_time — Handler for AgentMCPServer engine
// ---------------------------------------------------------------------------

import type { GetCurrentTimeOutput } from '../types/tools.js';

function formatOffset(minutes: number): string {
  const sign = minutes <= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Returns the current system time with timezone and offset information.
 * No args needed — the prompt is just "get_current_time {}"
 */
export async function handleGetCurrentTime(): Promise<string> {
  try {
    const now = new Date();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offsetMinutes = now.getTimezoneOffset();
    const offset = formatOffset(offsetMinutes);

    const result: GetCurrentTimeOutput = {
      iso: now.toISOString(),
      timezone,
      offset,
      unix: now.getTime(),
    };

    return JSON.stringify({
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return JSON.stringify({
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    });
  }
}
