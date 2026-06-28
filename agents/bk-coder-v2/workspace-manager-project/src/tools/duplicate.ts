import { z } from 'zod';
import { WorkspaceManager } from '../WorkspaceManager.js';

export const duplicateInputSchema = z.object({
  name: z.string().describe('Nombre del proyecto origen a duplicar'),
  newName: z.string().describe('Nombre del nuevo proyecto'),
  newRoot: z.string().optional().describe('Ruta del nuevo proyecto (opcional, usa el mismo root si no se especifica)'),
});

export async function duplicateHandler(
  args: z.infer<typeof duplicateInputSchema>,
  wm: WorkspaceManager,
): Promise<string> {
  const result = wm.duplicate(args.name, args.newName, args.newRoot);
  return JSON.stringify(result);
}
