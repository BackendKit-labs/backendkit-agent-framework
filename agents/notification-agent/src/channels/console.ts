import type { ChannelResult } from '../types/notification.js';

const PRIORITY_EMOJI: Record<string, string> = {
  low: '⚪',
  normal: '🔵',
  high: '🟠',
  critical: '🔴',
};

export async function sendConsole(params: { body: string; priority?: string }): Promise<ChannelResult> {
  const now = new Date().toISOString();
  const emoji = PRIORITY_EMOJI[params.priority || 'normal'] || '🔵';
  const line = `${emoji} [${now}] ${params.body}`;
  console.log(line);

  return {
    success: true,
    status: 'sent',
    deliveredAt: now,
    latencyMs: 0,
  };
}
