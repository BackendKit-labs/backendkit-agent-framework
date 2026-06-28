// ---------------------------------------------------------------------------
// Tool: send_notification
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
  const bodyMatch = prompt.match(/:\s*(.+)/);
  const body = bodyMatch?.[1] || 'Notificación vacía';

  switch (channel) {
    case 'console':
      return JSON.stringify(await sendConsole({ body }));
    case 'director':
      return JSON.stringify(await sendDirector({ body }));
    case 'email':
      return JSON.stringify(await sendEmail({ to: 'destinatario@email.com', subject: 'Notificación', body }));
    case 'slack':
      return JSON.stringify(await sendSlack({ body, priority: 'normal' }));
    case 'telegram':
      return JSON.stringify(await sendTelegram({ body }));
    case 'discord':
      return JSON.stringify(await sendDiscord({ body, priority: 'normal' }));
    case 'webhook':
      return JSON.stringify(await sendWebhook({ to: 'destinatario', body }));
    case 'push':
      return JSON.stringify(await sendPush({ provider: 'fcm', tokens: ['device-token'], title: 'Notificación', body }));
    default:
      return JSON.stringify({
        success: false,
        status: 'failed',
        deliveredAt: new Date().toISOString(),
        error: `Canal '${channel}' no implementado`,
        latencyMs: 0,
      });
  }
}
