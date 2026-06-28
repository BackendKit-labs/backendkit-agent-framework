import { z } from 'zod';
import { WorkspaceManager } from '../WorkspaceManager.js';

export const policiesInputSchema = z.object({
  domain: z.string().optional().describe('Filtrar políticas por dominio'),
  keywords: z
    .array(z.string())
    .optional()
    .describe('Filtrar políticas por keywords (si alguna coincide, se incluye)'),
});

export async function policiesHandler(
  args: z.infer<typeof policiesInputSchema>,
  wm: WorkspaceManager,
): Promise<string> {
  const result = wm.policies(args.domain, args.keywords);
  return JSON.stringify(result);
}
