import { z } from 'zod';
import { WorkspaceManager } from '../WorkspaceManager.js';

export const currentInputSchema = z.object({});

export async function currentHandler(_args: z.infer<typeof currentInputSchema>, wm: WorkspaceManager): Promise<string> {
  const project = wm.current();
  return JSON.stringify(project);
}
