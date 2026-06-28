import { z } from 'zod';
import { WorkspaceManager } from '../WorkspaceManager.js';

export const getRootInputSchema = z.object({
  projectId: z.string().optional().describe('ID del proyecto (opcional, usa el activo si no se especifica)'),
});

export async function getRootHandler(args: z.infer<typeof getRootInputSchema>, wm: WorkspaceManager): Promise<string> {
  const result = wm.getRoot(args.projectId);
  return JSON.stringify(result);
}
