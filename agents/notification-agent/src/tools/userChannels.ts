// ---------------------------------------------------------------------------
// Tool: user_channels
// ---------------------------------------------------------------------------

import { getUser } from '../storage/users.js';

export async function handler(prompt: string): Promise<string> {
  const userIdMatch = prompt.match(/para (\S+) de empresa (\S+)/);
  const userId = userIdMatch?.[1] || 'unknown';
  const companyId = userIdMatch?.[2] || 'unknown';

  const user = getUser(userId, companyId);

  if (!user) {
    return JSON.stringify({
      userId,
      companyId,
      channels: [],
      recommendedChannel: 'email',
      hasActiveChannel: false,
    });
  }

  const channels = [
    { name: 'email', configured: !!user.channels.email, verified: user.channels.email?.verified || false, preference: user.preferences.order.indexOf('email') },
    { name: 'push', configured: !!user.channels.push, verified: !!user.channels.push?.token, preference: user.preferences.order.indexOf('push') },
    { name: 'telegram', configured: !!user.channels.telegram, verified: !!user.channels.telegram?.chatId, preference: user.preferences.order.indexOf('telegram') },
    { name: 'slack', configured: !!user.channels.slack, verified: !!user.channels.slack?.webhookUrl, preference: user.preferences.order.indexOf('slack') },
    { name: 'discord', configured: !!user.channels.discord, verified: !!user.channels.discord?.webhookUrl, preference: user.preferences.order.indexOf('discord') },
  ].filter(c => c.preference >= 0).sort((a, b) => a.preference - b.preference);

  const hasActiveChannel = channels.some(c => c.verified);
  const recommendedChannel = channels.find(c => c.verified)?.name || 'email';

  return JSON.stringify({
    userId,
    companyId,
    channels,
    recommendedChannel,
    hasActiveChannel,
  });
}
