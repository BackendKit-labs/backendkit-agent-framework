// ---------------------------------------------------------------------------
// Check: Messaging — verifica conectividad al broker de mensajería
// ---------------------------------------------------------------------------

import { createConnection } from 'net';
import { getCached, setCache } from '../cache.js';
import type { MessagingCheck } from '../types.js';

const BROKER_URL = process.env.BROKER_URL;
const CONNECT_TIMEOUT_MS = 3000;

function parseBrokerUrl(url: string): { type: 'redis' | 'rabbitmq'; host: string; port: number } | null {
  try {
    const u = new URL(url);
    const host = u.hostname || 'localhost';
    const port = parseInt(u.port, 10) || (u.protocol.includes('redis') ? 6379 : 5672);
    const type = u.protocol.includes('redis') ? 'redis' as const : 'rabbitmq' as const;
    return { type, host, port };
  } catch {
    return null;
  }
}

function tryConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export async function checkMessaging(): Promise<MessagingCheck> {
  const cached = getCached<MessagingCheck>('messaging');
  if (cached) return cached;

  if (!BROKER_URL) {
    const result: MessagingCheck = { status: 'not_configured', type: 'none' };
    setCache('messaging', result);
    return result;
  }

  const parsed = parseBrokerUrl(BROKER_URL);
  if (!parsed) {
    const result: MessagingCheck = { status: 'disconnected', type: 'none' };
    setCache('messaging', result);
    return result;
  }

  const connected = await tryConnect(parsed.host, parsed.port, CONNECT_TIMEOUT_MS);
  const result: MessagingCheck = {
    status: connected ? 'connected' : 'disconnected',
    type: parsed.type,
  };
  setCache('messaging', result);
  return result;
}
