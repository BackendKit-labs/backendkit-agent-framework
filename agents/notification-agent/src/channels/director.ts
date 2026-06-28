import type { ChannelResult } from '../types/notification.js';

const PRIORITY_PREFIX: Record<string, string> = {
  low: 'ℹ️',
  normal: '📢',
  high: '⚠️',
  critical: '🚨',
};

export async function sendDirector(params: { body: string; priority?: string }): Promise<ChannelResult> {
  const prefix = PRIORITY_PREFIX[params.priority || 'normal'] || '📢';
  const markdown = `${prefix} ${params.body}`;

  return {
    success: true,
    status: 'sent',
    deliveredAt: new Date().toISOString(),
    latencyMs: 0,
    content: markdown,
  };
}
