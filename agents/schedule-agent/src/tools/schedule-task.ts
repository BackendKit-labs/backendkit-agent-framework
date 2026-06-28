// ---------------------------------------------------------------------------
// schedule_task — Handler for AgentMCPServer engine
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { ScheduleTaskInputSchema } from '../types/tools.js';
import type { TaskService } from '../services/task-service.js';
import { AuthService } from '../services/auth-service.js';

/**
 * Parses the prompt to extract args, validates, authorizes, and executes.
 * The prompt format is: "schedule_task <JSON args>"
 */
export async function handleScheduleTask(
  prompt: string,
  taskService: TaskService,
  authService: AuthService
): Promise<string> {
  try {
    // Extract JSON args from prompt
    const jsonStr = prompt.replace(/^schedule_task\s+/, '');
    const args = JSON.parse(jsonStr);

    const parsed = ScheduleTaskInputSchema.parse(args);

    // Authorization check
    if (!authService.canScheduleTask(parsed.userRole, parsed.type)) {
      return JSON.stringify({
        content: [
          {
            type: 'text',
            text: 'Forbidden: only admins and managers can create cron tasks',
          },
        ],
        isError: true,
      });
    }

    const result = taskService.createTask(parsed);
    return JSON.stringify({
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    });
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
        : error instanceof Error
          ? error.message
          : 'Unknown error';
    return JSON.stringify({
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    });
  }
}
