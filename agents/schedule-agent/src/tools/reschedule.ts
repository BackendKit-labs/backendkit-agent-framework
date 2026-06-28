// ---------------------------------------------------------------------------
// reschedule — Handler for AgentMCPServer engine
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { RescheduleInputSchema } from '../types/tools.js';
import type { TaskService } from '../services/task-service.js';
import { AuthService } from '../services/auth-service.js';

/**
 * Parses the prompt to extract args, validates, authorizes, and executes.
 * The prompt format is: "reschedule <JSON args>"
 */
export async function handleReschedule(
  prompt: string,
  taskService: TaskService,
  authService: AuthService
): Promise<string> {
  try {
    const jsonStr = prompt.replace(/^reschedule\s+/, '');
    const args = JSON.parse(jsonStr);

    const parsed = RescheduleInputSchema.parse(args);

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
            text: 'Forbidden: you can only reschedule your own tasks',
          },
        ],
        isError: true,
      });
    }

    const result = taskService.rescheduleTask(parsed);
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
