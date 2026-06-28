import { z } from 'zod';
import { WorkspaceManager } from '../WorkspaceManager.js';

export const switchInputSchema = z.object({
  name: z.string().describe('Nombre del proyecto al que switchear'),
});

export async function switchHandler(args: z.infer<typeof switchInputSchema>, wm: WorkspaceManager): Promise<string> {
  const result = wm.switch(args.name);
  return JSON.stringify(result);
}
