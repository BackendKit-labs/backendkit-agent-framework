import { z } from 'zod';
import type { AgentToolDef } from '@backendkit-labs/mcp-server';

export const readProjectFilesSchema = {
  paths: z.array(z.string()).min(1).describe('Rutas relativas a leer desde el projectRoot'),
};

export const readProjectFilesTool: AgentToolDef<typeof readProjectFilesSchema> = {
  name: 'read_project_files',
  description: 'Lee archivos del proyecto para contexto',
  schema: readProjectFilesSchema,
  buildPrompt: (args: any) => {
    return `Read the following files and return their contents as a JSON object:
${args.paths.map((p: string) => `- ${p}`).join('\n')}

Return ONLY: { "files": { "path": "content" } }`;
  },
};
