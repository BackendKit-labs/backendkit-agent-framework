// ---------------------------------------------------------------------------
// Service: Resolve Channel — elige el mejor canal según preferencias del usuario
// ---------------------------------------------------------------------------

import { getUser } from '../storage/users.js';
import { isQuietHours, filterNonIntrusive } from './quietHours.js';
import type { UserData } from '../types/user.js';

export interface ResolvedChannel {
  channel: string | null
  reason: string
}

export function resolveBestChannel(
  userId: string,
  companyId: string,
  priority: string = 'normal'
): ResolvedChannel {
  const user = getUser(userId, companyId);

  if (!user) {
    return { channel: null, reason: `Usuario ${userId} de empresa ${companyId} no registrado` };
  }

  const order = user.preferences?.order || ['email'];
  const quietConfig = user.preferences?.quiet_hours;
  const isCritical = priority === 'critical';

  // Determinar si está en quiet hours
  const inQuietHours = !isCritical && quietConfig
    ? isQuietHours(quietConfig)
    : false;

  // Filtrar canales según quiet hours
  let available = isCritical ? order : filterNonIntrusive(order, inQuietHours);

  // Verificar que los canales estén configurados y verificados
  for (const ch of available) {
    if (isChannelAvailable(user, ch)) {
      return { channel: ch, reason: `Canal '${ch}' seleccionado según preferencias` };
    }
  }

  return { channel: null, reason: 'Ningún canal disponible (verificar configuración del usuario)' };
}

function isChannelAvailable(user: UserData, channel: string): boolean {
  switch (channel) {
    case 'email':
      return !!user.channels.email?.verified;
    case 'push':
      return !!user.channels.push?.token;
    case 'telegram':
      return !!user.channels.telegram?.chatId;
    case 'slack':
      return !!user.channels.slack?.webhookUrl;
    case 'discord':
      return !!user.channels.discord?.webhookUrl;
    case 'in_app':
      return !!user.channels.in_app?.enabled;
    default:
      return false;
  }
}
