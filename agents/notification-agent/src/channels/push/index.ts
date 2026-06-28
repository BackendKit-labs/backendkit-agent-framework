// ---------------------------------------------------------------------------
// Push Router — elige el provider según configuración
// ---------------------------------------------------------------------------

import type { ChannelResult } from '../../types/notification.js';
import type { PushPayload } from '../../types/push.js';
import { sendFcm } from './fcm.js';
import { sendExpo } from './expo.js';
import { sendOneSignal } from './onesignal.js';

export async function sendPush(payload: PushPayload): Promise<ChannelResult> {
  const provider = payload.provider || detectProvider();

  switch (provider) {
    case 'fcm':
      return sendFcm(payload);
    case 'expo':
      return sendExpo(payload);
    case 'onesignal':
      return sendOneSignal(payload);
    default:
      return {
        success: false,
        status: 'failed',
        deliveredAt: new Date().toISOString(),
        error: `Provider '${provider}' no soportado. Usá: fcm, expo, onesignal`,
        latencyMs: 0,
      };
  }
}

function detectProvider(): 'fcm' | 'expo' | 'onesignal' {
  if (process.env.FCM_SERVER_KEY) return 'fcm';
  if (process.env.EXPO_ACCESS_TOKEN) return 'expo';
  if (process.env.ONESIGNAL_APP_ID && process.env.ONESIGNAL_API_KEY) return 'onesignal';
  return 'fcm'; // default
}
