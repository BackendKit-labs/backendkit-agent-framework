import { z } from 'zod';
import { WorkspaceManager } from '../WorkspaceManager.js';

export const agentExistsInputSchema = z.object({
  agentId: z.string().describe('ID del agente a verificar'),
  projectId: z.string().optional().describe('ID del proyecto (opcional, usa el activo si no se especifica)'),
});

export async function agentExistsHandler(
  args: z.infer<typeof agentExistsInputSchema>,
  wm: WorkspaceManager,
): Promise<string> {
  const result = wm.agentExists(args.agentId, args.projectId);
  return JSON.stringify(result);
}
