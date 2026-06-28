// ---------------------------------------------------------------------------
// Service: Notify User — orquesta resolución + envío + fallbacks + history
// ---------------------------------------------------------------------------

import { v4 as uuid } from 'uuid';
import { getUser } from '../storage/users.js';
import { saveNotification } from '../storage/history.js';
import { resolveBestChannel } from './resolveChannel.js';
import { sendConsole } from '../channels/console.js';
import { sendDirector } from '../channels/director.js';
import { sendEmail } from '../channels/email.js';
import { sendSlack } from '../channels/slack.js';
import { sendTelegram } from '../channels/telegram.js';
import { sendDiscord } from '../channels/discord.js';
import { sendWebhook } from '../channels/webhook.js';
import { sendPush } from '../channels/push/index.js';
import type { ChannelResult } from '../types/notification.js';

export interface NotifyUserInput {
  userId: string
  companyId: string
  title: string
  body: string
  context: {
    type: string
    action?: string
    referenceId?: string
    referenceUrl?: string
  }
  priority?: string
  forceChannel?: string
  source: string
}

export interface NotifyUserResult {
  id: string
  userId: string
  channel: string
  status: "sent" | "failed"
  deliveredAt: string
  fallbackUsed?: boolean
  attempts: { channel: string; status: string; error?: string }[]
}

// Mapa de canales a funciones de envío
const channelSenders: Record<string, (params: any) => Promise<ChannelResult>> = {
  console: (p) => sendConsole(p),
  director: (p) => sendDirector(p),
  email: (p) => sendEmail({ to: p.to || 'destinatario@email.com', subject: p.title, body: p.body }),
  slack: (p) => sendSlack({ body: p.body, priority: p.priority }),
  telegram: (p) => sendTelegram({ body: p.body }),
  discord: (p) => sendDiscord({ body: p.body, priority: p.priority }),
  webhook: (p) => sendWebhook({ to: p.to || 'https://hook.example.com', body: p.body }),
  push: (p) => sendPush({ provider: 'fcm', tokens: ['device-token'], title: p.title, body: p.body }),
};

export async function notifyUser(input: NotifyUserInput): Promise<NotifyUserResult> {
  const id = uuid();
  const attempts: { channel: string; status: string; error?: string }[] = [];
  const startTime = Date.now();

  // 1. Determinar canal(es) a intentar
  let channelsToTry: string[] = [];

  if (input.forceChannel) {
    // Validar que el canal forzado existe
    if (!channelSenders[input.forceChannel]) {
      return {
        id, userId: input.userId, channel: input.forceChannel,
        status: 'failed', deliveredAt: new Date().toISOString(),
        attempts: [{ channel: input.forceChannel, status: 'failed', error: `Canal '${input.forceChannel}' no soportado` }],
      };
    }
    channelsToTry = [input.forceChannel];
  } else {
    // Resolver mejor canal
    const resolved = resolveBestChannel(input.userId, input.companyId, input.priority);
    if (!resolved.channel) {
      return {
        id, userId: input.userId, channel: '',
        status: 'failed', deliveredAt: new Date().toISOString(),
        attempts: [], fallbackUsed: false,
      };
    }
    // Obtener orden completo para fallbacks
    const user = getUser(input.userId, input.companyId);
    channelsToTry = user?.preferences?.order || [resolved.channel];
    // Mover el canal resuelto al inicio
    const idx = channelsToTry.indexOf(resolved.channel);
    if (idx > 0) {
      channelsToTry.splice(idx, 1);
      channelsToTry.unshift(resolved.channel);
    }
  }

  // 2. Intentar envíos con fallbacks
  let lastResult: ChannelResult | null = null;
  let usedChannel = '';

  for (const ch of channelsToTry) {
    const sender = channelSenders[ch];
    if (!sender) continue;

    try {
      lastResult = await sender({
        body: input.body,
        title: input.title,
        priority: input.priority || 'normal',
        to: input.context.referenceUrl,
      });

      attempts.push({
        channel: ch,
        status: lastResult.success ? 'sent' : 'failed',
        error: lastResult.error,
      });

      if (lastResult.success) {
        usedChannel = ch;
        break; // Éxito, no seguir con fallbacks
      }
    } catch (err) {
      attempts.push({
        channel: ch,
        status: 'failed',
        error: (err as Error).message,
      });
    }
  }

  // 3. Armar resultado
  const result: NotifyUserResult = {
    id,
    userId: input.userId,
    channel: usedChannel || channelsToTry[0] || '',
    status: usedChannel ? 'sent' : 'failed',
    deliveredAt: new Date().toISOString(),
    fallbackUsed: attempts.length > 1,
    attempts,
  };

  // 4. Guardar en historial
  saveNotification({
    id,
    userId: input.userId,
    companyId: input.companyId,
    channel: result.channel,
    title: input.title,
    body: input.body,
    status: result.status,
    createdAt: new Date(startTime).toISOString(),
    deliveredAt: result.deliveredAt,
    retryCount: 0,
    fallbackUsed: result.fallbackUsed || false,
    source: input.source,
    context: input.context,
    attempts,
  });

  return result;
}
