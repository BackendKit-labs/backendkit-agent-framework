import { z } from 'zod';
import { WorkspaceManager } from '../WorkspaceManager.js';

const agentConfigSchema = z.object({
  model: z.string().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  srcPath: z.string().optional(),
  specPath: z.string().optional(),
  tools: z.array(z.string()).optional(),
});

export const createInputSchema = z.object({
  name: z.string().describe('Nombre único del proyecto'),
  root: z.string().describe('Ruta absoluta del directorio del proyecto'),
  description: z.string().optional().describe('Descripción opcional del proyecto'),
  agents: z
    .record(z.string(), agentConfigSchema)
    .optional()
    .describe('Configuración de agentes. Si no se especifica, se usan defaults.'),
  policies: z
    .object({
      enabled: z.array(z.string()).optional(),
    })
    .optional()
    .describe('Políticas activas del proyecto'),
  gates: z
    .object({
      designReview: z.enum(['auto', 'human', 'disabled']).optional(),
      securityReview: z.enum(['auto', 'human', 'disabled']).optional(),
      qaApproval: z.enum(['auto', 'human', 'disabled']).optional(),
    })
    .optional()
    .describe('Configuración de gates'),
});

export async function createHandler(args: z.infer<typeof createInputSchema>, wm: WorkspaceManager): Promise<string> {
  const result = wm.create(args.name, args.root, args.description, args.agents as any, args.policies, args.gates);
  return JSON.stringify(result);
}
