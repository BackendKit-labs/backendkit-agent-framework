// ---------------------------------------------------------------------------
// list_scheduled — Handler for AgentMCPServer engine
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { ListScheduledInputSchema } from '../types/tools.js';
import type { TaskService } from '../services/task-service.js';
import { AuthService } from '../services/auth-service.js';

/**
 * Parses the prompt to extract args, validates, authorizes, and executes.
 * The prompt format is: "list_scheduled <JSON args>"
 */
export async function handleListScheduled(
  prompt: string,
  taskService: TaskService,
  authService: AuthService
): Promise<string> {
  try {
    const jsonStr = prompt.replace(/^list_scheduled\s+/, '');
    const args = JSON.parse(jsonStr);

    const parsed = ListScheduledInputSchema.parse(args);

    // Authorization: non-admin/manager users can only see their own tasks
    if (!authService.canViewAllTasks(parsed.userRole)) {
      if (!parsed.createdBy) {
        return JSON.stringify({
          content: [
            {
              type: 'text',
              text: 'Forbidden: user role requires createdBy filter',
            },
          ],
          isError: true,
        });
      }
    }

    const result = taskService.listTasks(parsed);
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
