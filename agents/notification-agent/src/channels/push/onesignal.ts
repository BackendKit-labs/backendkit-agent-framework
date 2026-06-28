// ---------------------------------------------------------------------------
// Push Provider: OneSignal
// ---------------------------------------------------------------------------

import { HttpClient } from '@backendkit-labs/http-client';
import type { ChannelResult } from '../../types/notification.js';
import type { PushPayload } from '../../types/push.js';

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;

const client = new HttpClient({
  timeout: 10_000,
  retry: { attempts: 2 },
  circuitBreaker: { name: 'onesignal', failureThreshold: 3, openTimeoutMs: 30_000 },
});

export async function sendOneSignal(payload: PushPayload): Promise<ChannelResult> {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) {
    return {
      success: false,
      status: 'failed',
      deliveredAt: new Date().toISOString(),
      error: 'ONESIGNAL_APP_ID o ONESIGNAL_API_KEY no configurados.',
      latencyMs: 0,
    };
  }

  const start = Date.now();

  const result = await client.post(
    'https://onesignal.com/api/v1/notifications',
    {
      app_id: ONESIGNAL_APP_ID,
      include_player_ids: payload.tokens,
      headings: { en: payload.title },
      contents: { en: payload.body },
      subtitle: payload.group ? { en: payload.groupSummary } : undefined,
      data: payload.data,
      ios_sound: payload.sound,
      android_sound: payload.sound,
      ios_badgeType: 'Increase',
      ios_badgeCount: payload.badge,
      ttl: payload.ttl ? Math.floor(payload.ttl / 1000) : undefined,
      priority: payload.androidPriority === 'high' ? 10 : 5,
    },
    {
      headers: {
        Authorization: `Basic ${ONESIGNAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (result.ok) {
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
    error: `OneSignal error: ${result.error.message}`,
    latencyMs: Date.now() - start,
  };
}
