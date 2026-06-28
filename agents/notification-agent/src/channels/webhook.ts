// ---------------------------------------------------------------------------
// Channel: Webhook — POST genérico a URL en 'to'
// ---------------------------------------------------------------------------

import { HttpClient } from '@backendkit-labs/http-client';
import type { ChannelResult } from '../types/notification.js';

const client = new HttpClient({
  timeout: 10_000,
  retry: { attempts: 3 },
  circuitBreaker: { name: 'webhook', failureThreshold: 3, openTimeoutMs: 30_000 },
});

export async function sendWebhook(params: { to: string; body: string; headers?: Record<string, string> }): Promise<ChannelResult> {
  if (!params.to) {
    return {
      success: false,
      status: 'failed',
      deliveredAt: new Date().toISOString(),
      error: 'URL de webhook no proporcionada. Usá el campo "to" con la URL destino.',
      latencyMs: 0,
    };
  }

  const start = Date.now();

  const result = await client.post(params.to, { text: params.body }, {
    headers: { 'Content-Type': 'application/json', ...params.headers },
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
    error: `Webhook error: ${result.error.message}`,
    latencyMs: Date.now() - start,
  };
}
