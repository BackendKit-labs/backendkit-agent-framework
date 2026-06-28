// ---------------------------------------------------------------------------
// Tool: test_channel
// ---------------------------------------------------------------------------

import { sendConsole } from '../channels/console.js';
import { sendDirector } from '../channels/director.js';
import { sendEmail } from '../channels/email.js';
import { sendSlack } from '../channels/slack.js';
import { sendTelegram } from '../channels/telegram.js';
import { sendDiscord } from '../channels/discord.js';
import { sendWebhook } from '../channels/webhook.js';
import { sendPush } from '../channels/push/index.js';

export async function handler(prompt: string): Promise<string> {
  const channelMatch = prompt.match(/canal (\w+)/);
  const channel = channelMatch?.[1] || 'console';
  const toMatch = prompt.match(/to (\S+)/);
  const to = toMatch?.[1];

  const testMessage = `🔔 Notificación de prueba desde notification-agent (${new Date().toISOString()})`;

  const senders: Record<string, (params: any) => Promise<any>> = {
    console: (p) => sendConsole(p),
    director: (p) => sendDirector(p),
    email: (p) => sendEmail({ to: to || 'test@test.com', subject: 'Test notification-agent', body: p.body }),
    slack: (p) => sendSlack({ body: p.body, priority: 'normal' }),
    telegram: (p) => sendTelegram({ body: p.body }),
    discord: (p) => sendDiscord({ body: p.body, priority: 'normal' }),
    webhook: (p) => sendWebhook({ to: to || 'https://hook.example.com', body: p.body }),
    push: (p) => sendPush({ provider: 'fcm', tokens: [to || 'device-token'], title: 'Test', body: p.body }),
  };

  const sender = senders[channel];
  if (!sender) {
    return JSON.stringify({ success: false, latencyMs: 0, message: `Canal '${channel}' no soportado` });
  }

  const start = Date.now();
  const result = await sender({ body: testMessage });
  const latency = Date.now() - start;

  return JSON.stringify({
    success: result.success,
    latencyMs: latency,
    message: result.success ? `Test enviado por ${channel} (${latency}ms)` : `Error: ${result.error}`,
  });
}
