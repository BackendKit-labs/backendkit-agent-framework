// ---------------------------------------------------------------------------
// Channel: Slack — Webhook HTTP con blocks y color según prioridad
// ---------------------------------------------------------------------------

import { HttpClient } from '@backendkit-labs/http-client';
import type { ChannelResult } from '../types/notification.js';

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

const PRIORITY_COLORS: Record<string, string> = {
  low: '#95A5A6',
  normal: '#3498DB',
  high: '#FFA500',
  critical: '#FF0000',
};

const client = new HttpClient({
  timeout: 10_000,
  retry: { attempts: 3 },
  circuitBreaker: { name: 'slack', failureThreshold: 3, openTimeoutMs: 30_000 },
});

export async function sendSlack(params: { body: string; priority?: string }): Promise<ChannelResult> {
  if (!SLACK_WEBHOOK_URL) {
    return {
      success: false,
      status: 'failed',
      deliveredAt: new Date().toISOString(),
      error: 'SLACK_WEBHOOK_URL no configurado. Usá SLACK_WEBHOOK_URL en las env vars.',
      latencyMs: 0,
    };
  }

  const color = PRIORITY_COLORS[params.priority || 'normal'] || '#3498DB';
  const start = Date.now();

  const result = await client.post(SLACK_WEBHOOK_URL, {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🔔 Notificación' },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: params.body },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `Prioridad: ${params.priority || 'normal'} · ${new Date().toISOString()}` }],
      },
    ],
    attachments: [{
      color,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: params.body } }],
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
    error: `Slack webhook error: ${result.error.message}`,
    latencyMs: Date.now() - start,
  };
}
