import { z } from 'zod';
import { WorkspaceManager } from '../WorkspaceManager.js';

export const listInputSchema = z.object({});

export async function listHandler(_args: z.infer<typeof listInputSchema>, wm: WorkspaceManager): Promise<string> {
  const result = wm.list();
  return JSON.stringify(result);
}
