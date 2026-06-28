// ---------------------------------------------------------------------------
// Tool: list_devices
// ---------------------------------------------------------------------------

import { listDevices } from '../storage/devices.js';

export async function handler(): Promise<string> {
  const result = listDevices();
  return JSON.stringify(result);
}
