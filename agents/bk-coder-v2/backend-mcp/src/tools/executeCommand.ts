import { z } from 'zod';
import type { AgentToolDef } from '@backendkit-labs/mcp-server';

export const executeCommandSchema = {
  command: z.string().min(1).describe('Comando a ejecutar'),
  cwd: z.string().optional().describe('Directorio de trabajo (default: projectRoot)'),
};

export const executeCommandTool: AgentToolDef<typeof executeCommandSchema> = {
  name: 'execute_command',
  description: 'Ejecuta comandos en el projectRoot',
  schema: executeCommandSchema,
  buildPrompt: (args: any) => {
    return `Execute the command and return the result:
Command: ${args.command}
Working directory: ${args.cwd || 'projectRoot'}

Return: { "stdout": "...", "stderr": "...", "exitCode": 0 }`;
  },
};
