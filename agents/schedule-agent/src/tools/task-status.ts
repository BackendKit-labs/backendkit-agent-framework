// ---------------------------------------------------------------------------
// task_status — Handler for AgentMCPServer engine
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { TaskStatusInputSchema } from '../types/tools.js';
import type { TaskService } from '../services/task-service.js';
import { AuthService } from '../services/auth-service.js';

/**
 * Parses the prompt to extract args, validates, authorizes, and executes.
 * The prompt format is: "task_status <JSON args>"
 */
export async function handleTaskStatus(
  prompt: string,
  taskService: TaskService,
  authService: AuthService
): Promise<string> {
  try {
    const jsonStr = prompt.replace(/^task_status\s+/, '');
    const args = JSON.parse(jsonStr);

    const parsed = TaskStatusInputSchema.parse(args);

    // Fetch task to check ownership
    const task = taskService.getTaskById(parsed.id);
    if (!task) {
      return JSON.stringify({
        content: [{ type: 'text', text: `Error: Task ${parsed.id} not found` }],
        isError: true,
      });
    }

    // Authorization check
    if (!authService.canViewTaskStatus(parsed.userRole, task.createdBy, parsed.requestedBy)) {
      return JSON.stringify({
        content: [
          {
            type: 'text',
            text: 'Forbidden: you can only view status of your own tasks',
          },
        ],
        isError: true,
      });
    }

    const result = taskService.getTaskStatus(parsed.id);
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
