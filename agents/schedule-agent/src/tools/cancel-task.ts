// ---------------------------------------------------------------------------
// cancel_task — Handler for AgentMCPServer engine
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { CancelTaskInputSchema } from '../types/tools.js';
import type { TaskService } from '../services/task-service.js';
import { AuthService } from '../services/auth-service.js';

/**
 * Parses the prompt to extract args, validates, authorizes, and executes.
 * The prompt format is: "cancel_task <JSON args>"
 */
export async function handleCancelTask(
  prompt: string,
  taskService: TaskService,
  authService: AuthService
): Promise<string> {
  try {
    const jsonStr = prompt.replace(/^cancel_task\s+/, '');
    const args = JSON.parse(jsonStr);

    const parsed = CancelTaskInputSchema.parse(args);

    // Fetch task to check ownership
    const task = taskService.getTaskById(parsed.id);
    if (!task) {
      return JSON.stringify({
        content: [{ type: 'text', text: `Error: Task ${parsed.id} not found` }],
        isError: true,
      });
    }

    // Authorization check
    if (!authService.canModifyTask(parsed.userRole, task.createdBy, parsed.requestedBy)) {
      return JSON.stringify({
        content: [
          {
            type: 'text',
            text: 'Forbidden: you can only cancel your own tasks',
          },
        ],
        isError: true,
      });
    }

    const result = taskService.cancelTask(parsed);
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
