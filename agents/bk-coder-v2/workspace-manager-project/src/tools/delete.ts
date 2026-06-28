import { z } from 'zod';
import { WorkspaceManager } from '../WorkspaceManager.js';

export const deleteInputSchema = z.object({
  name: z.string().describe('Nombre del proyecto a eliminar'),
});

export async function deleteHandler(args: z.infer<typeof deleteInputSchema>, wm: WorkspaceManager): Promise<string> {
  const result = wm.delete(args.name);
  return JSON.stringify(result);
}
