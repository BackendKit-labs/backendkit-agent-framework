import { z } from 'zod';
import { WorkspaceManager } from '../WorkspaceManager.js';

export const getAgentConfigInputSchema = z.object({
  agentId: z.string().describe('ID del agente (backend, qa, security, design, infra)'),
  projectId: z.string().optional().describe('ID del proyecto (opcional, usa el activo si no se especifica)'),
});

export async function getAgentConfigHandler(
  args: z.infer<typeof getAgentConfigInputSchema>,
  wm: WorkspaceManager,
): Promise<string> {
  const result = wm.getAgentConfig(args.agentId, args.projectId);
  return JSON.stringify(result);
}
