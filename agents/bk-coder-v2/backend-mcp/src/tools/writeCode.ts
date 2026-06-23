import { z } from 'zod';
import type { AgentToolDef } from '@backendkit-labs/mcp-server';

export const writeCodeSchema = {
  filePath: z.string().min(1).describe('Ruta relativa desde projectRoot'),
  content: z.string().describe('Contenido del archivo'),
};

export const writeCodeTool: AgentToolDef<typeof writeCodeSchema> = {
  name: 'write_code',
  description: 'Escribe archivos en el projectRoot',
  schema: writeCodeSchema,
  buildPrompt: (args: any) => {
    return `Write the following content to ${args.filePath}:

${args.content}

Return: { "success": true, "path": "${args.filePath}" }`;
  },
};
