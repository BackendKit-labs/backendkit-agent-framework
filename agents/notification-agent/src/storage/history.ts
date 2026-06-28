// ---------------------------------------------------------------------------
// Storage: History — historial de notificaciones
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import type { NotificationRecord } from '../types/notification.js';

const DATA_DIR = process.env.NOTIFIER_DATA_DIR || resolve(homedir(), '.backendkit', 'notifier');
const HISTORY_PATH = resolve(DATA_DIR, 'history.json');

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readHistory(): Record<string, NotificationRecord> {
  try {
    ensureDir();
    if (!existsSync(HISTORY_PATH)) return {};
    return JSON.parse(readFileSync(HISTORY_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeHistory(history: Record<string, NotificationRecord>): void {
  ensureDir();
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8');
}

export function saveNotification(record: NotificationRecord): void {
  const history = readHistory();
  history[record.id] = record;
  writeHistory(history);
}

export function getHistory(filters?: {
  userId?: string;
  companyId?: string;
  channel?: string;
  status?: string;
  source?: string;
  since?: string;
  limit?: number;
}): { total: number; notifications: NotificationRecord[] } {
  let all = Object.values(readHistory());

  if (filters?.userId) all = all.filter((n) => n.userId === filters.userId);
  if (filters?.companyId) all = all.filter((n) => n.companyId === filters.companyId);
  if (filters?.channel) all = all.filter((n) => n.channel === filters.channel);
  if (filters?.status) all = all.filter((n) => n.status === filters.status);
  if (filters?.source) all = all.filter((n) => n.source === filters.source);
  if (filters?.since) all = all.filter((n) => new Date(n.createdAt) >= new Date(filters.since!));

  // Ordenar por fecha descendente
  all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const limit = filters?.limit || 50;
  return {
    total: all.length,
    notifications: all.slice(0, limit),
  };
}
