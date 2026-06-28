import { z } from 'zod';
import { WorkspaceManager } from '../WorkspaceManager.js';

export const gateConfigInputSchema = z.object({});

export async function gateConfigHandler(
  _args: z.infer<typeof gateConfigInputSchema>,
  wm: WorkspaceManager,
): Promise<string> {
  const result = wm.gateConfig();
  return JSON.stringify(result);
}
