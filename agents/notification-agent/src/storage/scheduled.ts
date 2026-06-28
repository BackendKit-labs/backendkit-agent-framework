// ---------------------------------------------------------------------------
// Storage: Scheduled — notificaciones programadas
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { v4 as uuid } from 'uuid';

export interface ScheduledNotification {
  id: string
  userId: string
  companyId: string
  title: string
  body: string
  context: any
  scheduleAt: string
  timezone?: string
  priority?: string
  source: string
  createdAt: string
  status: "scheduled" | "sent" | "failed"
}

const DATA_DIR = process.env.NOTIFIER_DATA_DIR || resolve(homedir(), '.backendkit', 'notifier');
const SCHEDULED_PATH = resolve(DATA_DIR, 'scheduled.json');

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readScheduled(): Record<string, ScheduledNotification> {
  try {
    ensureDir();
    if (!existsSync(SCHEDULED_PATH)) return {};
    return JSON.parse(readFileSync(SCHEDULED_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeScheduled(data: Record<string, ScheduledNotification>): void {
  ensureDir();
  writeFileSync(SCHEDULED_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

export function scheduleNotification(input: {
  userId: string
  companyId: string
  title: string
  body: string
  context: any
  scheduleAt: string
  timezone?: string
  priority?: string
  source: string
}): ScheduledNotification {
  const scheduled = readScheduled();
  const id = uuid();
  const record: ScheduledNotification = {
    id,
    ...input,
    createdAt: new Date().toISOString(),
    status: 'scheduled',
  };
  scheduled[id] = record;
  writeScheduled(scheduled);
  return record;
}
