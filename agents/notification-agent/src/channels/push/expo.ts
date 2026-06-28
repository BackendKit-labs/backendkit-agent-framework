// ---------------------------------------------------------------------------
// Push Provider: Expo — Expo Push Notifications
// ---------------------------------------------------------------------------

import { HttpClient } from '@backendkit-labs/http-client';
import type { ChannelResult } from '../../types/notification.js';
import type { PushPayload } from '../../types/push.js';

const client = new HttpClient({
  timeout: 10_000,
  retry: { attempts: 2 },
  circuitBreaker: { name: 'expo', failureThreshold: 3, openTimeoutMs: 30_000 },
});

export async function sendExpo(payload: PushPayload): Promise<ChannelResult> {
  const start = Date.now();

  const result = await client.post(
    'https://exp.host/--/api/v2/push/send',
    payload.tokens.map((token) => ({
      to: token,
      title: payload.title,
      body: payload.body,
      sound: payload.sound || 'default',
      badge: payload.badge,
      data: payload.data,
      priority: payload.androidPriority || 'high',
      ttl: payload.ttl,
    })),
    {
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
      },
    }
  );

  if (result.ok) {
    const data = result.value.data as any;
    // Detectar token expirado en Expo
    if (data?.data?.errors?.[0]?.code === 'DEVICE_NOT_REGISTERED') {
      return {
        success: false,
        status: 'failed',
        deliveredAt: new Date().toISOString(),
        error: 'Expo token no registrado',
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
    error: `Expo error: ${result.error.message}`,
    latencyMs: Date.now() - start,
  };
}
