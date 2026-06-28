// ---------------------------------------------------------------------------
// Tool: unregister_device
// ---------------------------------------------------------------------------

import { deactivateDevice } from '../storage/devices.js';

export async function handler(prompt: string): Promise<string> {
  const tokenMatch = prompt.match(/token (\S+)/);
  const token = tokenMatch?.[1] || 'unknown';
  deactivateDevice(token);
  return JSON.stringify({ status: 'unregistered' });
}
