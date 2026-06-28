// ---------------------------------------------------------------------------
// get_user_timezone — Handler for AgentMCPServer engine
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { GetUserTimezoneInputSchema } from '../types/tools.js';
import type { GetUserTimezoneOutput } from '../types/tools.js';

function formatOffset(minutes: number): string {
  const sign = minutes <= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Parses the prompt to extract userId, then returns the configured timezone.
 * The prompt format is: "get_user_timezone <JSON args>"
 */
export async function handleGetUserTimezone(prompt: string): Promise<string> {
  try {
    const jsonStr = prompt.replace(/^get_user_timezone\s+/, '');
    const args = JSON.parse(jsonStr);

    const parsed = GetUserTimezoneInputSchema.parse(args);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offsetMinutes = new Date().getTimezoneOffset();
    const offset = formatOffset(offsetMinutes);

    const result: GetUserTimezoneOutput = {
      userId: parsed.userId,
      timezone,
      offset,
      iana: timezone,
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
    const message =
      error instanceof z.ZodError
        ? error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
        : error instanceof Error
          ? error.message
          : 'Unknown error';
    return JSON.stringify({
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    });
  }
}
