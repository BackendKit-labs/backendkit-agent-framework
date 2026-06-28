import { z } from 'zod';
import { WorkspaceManager } from '../WorkspaceManager.js';

export const memoryConfigInputSchema = z.object({});

export async function memoryConfigHandler(
  _args: z.infer<typeof memoryConfigInputSchema>,
  wm: WorkspaceManager,
): Promise<string> {
  const result = wm.memoryConfig();
  return JSON.stringify(result);
}
