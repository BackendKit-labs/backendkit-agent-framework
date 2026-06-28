// ---------------------------------------------------------------------------
// Channel: Discord — Webhook HTTP con embeds y color según prioridad
// ---------------------------------------------------------------------------

import { HttpClient } from '@backendkit-labs/http-client';
import type { ChannelResult } from '../types/notification.js';

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const PRIORITY_COLORS: Record<string, number> = {
  low: 0x95A5A6,
  normal: 0x3498DB,
  high: 0xFFA500,
  critical: 0xFF0000,
};

const client = new HttpClient({
  timeout: 10_000,
  retry: { attempts: 3 },
  circuitBreaker: { name: 'discord', failureThreshold: 3, openTimeoutMs: 30_000 },
});

export async function sendDiscord(params: { body: string; priority?: string }): Promise<ChannelResult> {
  if (!DISCORD_WEBHOOK_URL) {
    return {
      success: false,
      status: 'failed',
      deliveredAt: new Date().toISOString(),
      error: 'DISCORD_WEBHOOK_URL no configurado. Usá DISCORD_WEBHOOK_URL en las env vars.',
      latencyMs: 0,
    };
  }

  const color = PRIORITY_COLORS[params.priority || 'normal'] || 0x3498DB;
  const start = Date.now();

  const result = await client.post(DISCORD_WEBHOOK_URL, {
    embeds: [{
      title: '🔔 Notificación',
      description: params.body,
      color,
      footer: { text: `Prioridad: ${params.priority || 'normal'}` },
      timestamp: new Date().toISOString(),
    }],
  });

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
    error: `Discord webhook error: ${result.error.message}`,
    latencyMs: Date.now() - start,
  };
}
