// ---------------------------------------------------------------------------
// Channel: Telegram — Bot API con parse_mode Markdown
// ---------------------------------------------------------------------------

import { HttpClient } from '@backendkit-labs/http-client';
import type { ChannelResult } from '../types/notification.js';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const client = new HttpClient({
  timeout: 10_000,
  retry: { attempts: 3 },
  circuitBreaker: { name: 'telegram', failureThreshold: 3, openTimeoutMs: 30_000 },
});

export async function sendTelegram(params: { body: string }): Promise<ChannelResult> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return {
      success: false,
      status: 'failed',
      deliveredAt: new Date().toISOString(),
      error: 'TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurados. Usá las env vars correspondientes.',
      latencyMs: 0,
    };
  }

  const start = Date.now();

  const result = await client.post(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      chat_id: TELEGRAM_CHAT_ID,
      text: params.body,
      parse_mode: 'Markdown',
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
    error: `Telegram API error: ${result.error.message}`,
    latencyMs: Date.now() - start,
  };
}
