// ---------------------------------------------------------------------------
// Tool: register_user_channels
// ---------------------------------------------------------------------------

import { saveUser, getUser } from '../storage/users.js';
import type { UserData } from '../types/user.js';

export async function handler(prompt: string): Promise<string> {
  // Extraer datos del prompt (simplificado - en producción vendrían del schema Zod)
  const userIdMatch = prompt.match(/para (\S+) de empresa (\S+)/);
  const userId = userIdMatch?.[1] || 'unknown';
  const companyId = userIdMatch?.[2] || 'unknown';

  const existing = getUser(userId, companyId);

  const userData: UserData = {
    userId,
    companyId,
    channels: {
      email: { address: `${userId}@email.com`, verified: true },
    },
    preferences: {
      order: ['email', 'push', 'telegram', 'slack', 'discord'],
    },
    devices: existing?.devices || [],
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  saveUser(userData);

  // Calcular recommendedChannel
  const recommendedChannel = userData.channels.email?.verified ? 'email' : 'push';

  return JSON.stringify({
    userId,
    status: existing ? 'updated' : 'registered',
    recommendedChannel,
  });
}
