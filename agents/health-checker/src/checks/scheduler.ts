// ---------------------------------------------------------------------------
// Check: Scheduler — lee tareas del scheduler-agent y reporta su estado
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { getCached, setCache } from '../cache.js';
import type { SchedulerCheck, SchedulerTask } from '../types.js';

const SCHEDULER_TASKS_PATH = process.env.SCHEDULER_TASKS_PATH || resolve(homedir(), '.backendkit', 'scheduler', 'tasks.json');

function resolvePath(filePath: string): string {
  if (filePath.startsWith('~')) {
    return resolve(homedir(), filePath.slice(1));
  }
  return resolve(filePath);
}

export async function checkScheduler(): Promise<SchedulerCheck> {
  const cached = getCached<SchedulerCheck>('scheduler');
  if (cached) return cached;

  const resolvedPath = resolvePath(SCHEDULER_TASKS_PATH);

  if (!existsSync(resolvedPath)) {
    const result: SchedulerCheck = {
      configured: false,
      tasks_scheduled: 0,
      tasks_overdue: 0,
      tasks_failed: 0,
      tasks: [],
    };
    setCache('scheduler', result);
    return result;
  }

  try {
    const content = readFileSync(resolvedPath, 'utf-8');
    const data = JSON.parse(content);
    const tasks: any[] = data.tasks || data || [];
    const now = Date.now();
    const overdue = tasks.filter((t: any) => t.nextRunAt && new Date(t.nextRunAt).getTime() < now);
    const failed = tasks.filter((t: any) => t.status === 'failed' || t.status === 'error');

    const result: SchedulerCheck = {
      configured: true,
      tasks_scheduled: tasks.length,
      tasks_overdue: overdue.length,
      tasks_failed: failed.length,
      tasks: tasks.map((t: any): SchedulerTask => ({
        id: t.id || 'unknown',
        type: t.type || 'unknown',
        status: t.status || 'unknown',
        nextRunAt: t.nextRunAt || '',
        overdue: t.nextRunAt ? new Date(t.nextRunAt).getTime() < now : false,
      })),
    };
    setCache('scheduler', result);
    return result;
  } catch {
    const result: SchedulerCheck = {
      configured: false,
      tasks_scheduled: 0,
      tasks_overdue: 0,
      tasks_failed: 0,
      tasks: [],
    };
    setCache('scheduler', result);
    return result;
  }
}
