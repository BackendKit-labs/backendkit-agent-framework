// ---------------------------------------------------------------------------
// Push Provider: FCM — Firebase Cloud Messaging
// ---------------------------------------------------------------------------

import { HttpClient } from '@backendkit-labs/http-client';
import type { ChannelResult } from '../../types/notification.js';
import type { PushPayload } from '../../types/push.js';

const FCM_SERVER_KEY = process.env.FCM_SERVER_KEY;

const client = new HttpClient({
  timeout: 10_000,
  retry: { attempts: 2 },
  circuitBreaker: { name: 'fcm', failureThreshold: 3, openTimeoutMs: 30_000 },
});

export async function sendFcm(payload: PushPayload): Promise<ChannelResult> {
  if (!FCM_SERVER_KEY) {
    return {
      success: false,
      status: 'failed',
      deliveredAt: new Date().toISOString(),
      error: 'FCM_SERVER_KEY no configurado. Usá FCM_SERVER_KEY en las env vars.',
      latencyMs: 0,
    };
  }

  const start = Date.now();

  const result = await client.post(
    'https://fcm.googleapis.com/fcm/send',
    {
      to: payload.tokens[0],
      notification: {
        title: payload.title,
        body: payload.body,
        icon: payload.icon,
        image: payload.image,
        sound: payload.sound || 'default',
        badge: payload.badge,
      },
      data: payload.data,
      android: { priority: payload.androidPriority || 'high' },
      apns: {
        payload: {
          aps: {
            sound: payload.sound || 'default',
            badge: payload.badge,
            'interruption-level': payload.iosInterruptionLevel || 'active',
          },
        },
      },
      time_to_live: payload.ttl,
    },
    {
      headers: {
        Authorization: `key=${FCM_SERVER_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (result.ok) {
    const data = result.value.data as any;
    // Detectar token expirado
    if (data?.results?.[0]?.error === 'NotRegistered' || data?.results?.[0]?.error === 'InvalidRegistration') {
      return {
        success: false,
        status: 'failed',
        deliveredAt: new Date().toISOString(),
        error: `FCM token expirado: ${data.results[0].error}`,
        latencyMs: Date.now() - start,
        tokenExpired: true,
      } as ChannelResult & { tokenExpired: boolean };
    }

    return {
      success: true,
      status: 'sent',
      deliveredAt: new Date().toISOString(),
      latencyMs: Date.now() - start,
    };
  }

  return {
    success: false,
    status: 'failed',
    deliveredAt: new Date().toISOString(),
    error: `FCM error: ${result.error.message}`,
    latencyMs: Date.now() - start,
  };
}
