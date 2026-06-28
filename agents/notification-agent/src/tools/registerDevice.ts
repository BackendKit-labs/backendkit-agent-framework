// ---------------------------------------------------------------------------
// Tool: register_device
// ---------------------------------------------------------------------------

import { addDevice } from '../storage/devices.js';

export async function handler(): Promise<string> {
  const device = addDevice({
    userId: 'user-id',
    companyId: 'company-id',
    provider: 'fcm',
    token: 'device-token',
    platform: 'web',
    active: true,
  });
  return JSON.stringify({ id: device.id, registeredAt: device.registeredAt, status: 'active' });
}
