import { z } from 'zod';
import { WorkspaceManager } from '../WorkspaceManager.js';

export const updateInputSchema = z.object({
  name: z.string().describe('Nombre del proyecto a actualizar'),
  updates: z
    .record(z.string(), z.any())
    .describe('Merge parcial con notación de path. Ej: {"agents.backend.model": "gpt-4o"}'),
});

export async function updateHandler(args: z.infer<typeof updateInputSchema>, wm: WorkspaceManager): Promise<string> {
  const result = wm.update(args.name, args.updates);
  return JSON.stringify(result);
}
