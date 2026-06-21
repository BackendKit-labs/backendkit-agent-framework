// ---------------------------------------------------------------------------
// Engine — Registry pattern + engine factory for AgentMCPServer
// ---------------------------------------------------------------------------
//
// This engine bridges the AgentMCPServer tool definitions with the actual
// business logic. Each tool's buildPrompt() generates a string that includes
// the tool name; the engine's run() method parses it, dispatches to the
// correct handler, and emits the result via CallbackTransport.
//
// The background SchedulerEngine (src/engine/engine.ts) runs independently
// and is started from src/index.ts.
// ---------------------------------------------------------------------------

import { CallbackTransport } from '@backendkit-labs/agent-core';
import type { TaskService } from './services/task-service.js';
import { auditLogger } from './audit.js';
import { AuthService } from './services/auth-service.js';
import { handleScheduleTask } from './tools/schedule-task.js';
import { handleListScheduled } from './tools/list-scheduled.js';
import { handleCancelTask } from './tools/cancel-task.js';
import { handleReschedule } from './tools/reschedule.js';
import { handleTaskStatus } from './tools/task-status.js';
import { handleGetCurrentTime } from './tools/get-current-time.js';
import { handleGetUserTimezone } from './tools/get-user-timezone.js';

type ToolHandler = (prompt: string) => Promise<string>;

const toolHandlers = new Map<string, ToolHandler>();

export function registerTool(name: string, handler: ToolHandler): void {
  toolHandlers.set(name, handler);
}

// ─── Engine factory ──────────────────────────────────────────────

export function createEngine(
  transport: CallbackTransport,
  taskService: TaskService
) {
  // Lazy-register handlers on first call (service is available now)
  if (toolHandlers.size === 0) {
    const authService = new AuthService();
    registerTool('schedule_task', (prompt) =>
      handleScheduleTask(prompt, taskService, authService)
    );
    registerTool('list_scheduled', (prompt) =>
      handleListScheduled(prompt, taskService, authService)
    );
    registerTool('cancel_task', (prompt) =>
      handleCancelTask(prompt, taskService, authService)
    );
    registerTool('reschedule', (prompt) =>
      handleReschedule(prompt, taskService, authService)
    );
    registerTool('task_status', (prompt) =>
      handleTaskStatus(prompt, taskService, authService)
    );
    registerTool('get_current_time', () => handleGetCurrentTime());
    registerTool('get_user_timezone', (prompt) =>
      handleGetUserTimezone(prompt)
    );
  }

  return {
    run: async (prompt: string): Promise<void> => {
      try {
        for (const [name, handler] of toolHandlers) {
          if (prompt.includes(name)) {
            const start = Date.now();
            try {
              const result = await handler(prompt);
              auditLogger.write({ tool: name, status: 'ok', durationMs: Date.now() - start });
              transport.emit({ type: 'token', content: result });
              transport.emit({ type: 'done' });
            } catch (handlerErr) {
              auditLogger.write({ tool: name, status: 'error', durationMs: Date.now() - start, error: String(handlerErr) });
              throw handlerErr;
            }
            return;
          }
        }
        transport.emit({
          type: 'token',
          content: JSON.stringify({ error: 'Unknown tool' }),
        });
        transport.emit({ type: 'done' });
      } catch (err) {
        transport.emit({
          type: 'error',
          message: `Engine error: ${String(err)}`,
        });
      }
    },
  };
}
