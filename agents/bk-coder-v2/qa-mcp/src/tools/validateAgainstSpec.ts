import { z } from 'zod';
import type { AgentToolDef } from '@backendkit-labs/mcp-server';

export const validateAgainstSpecSchema = {
  specPath: z.string().describe('Ruta al specification.md'),
  criterionId: z.string().describe('ID del criterio (ej: "RF-001", "C1")'),
  codePath: z.string().describe('Ruta del archivo a validar'),
};

export const validateAgainstSpecTool: AgentToolDef<typeof validateAgainstSpecSchema> = {
  name: 'validate_against_spec',
  description: 'Valida un archivo específico contra un criterio de la spec',
  schema: validateAgainstSpecSchema,
  buildPrompt: (args: any) => {
    const { specPath, criterionId, codePath } = args;
    return `Validate file "${codePath}" against criterion "${criterionId}".

1. Read the specification at: ${specPath}
2. Find criterion "${criterionId}"
3. Read the code at: ${codePath}
4. Determine if the criterion is met

Return: { "result": "✅" | "❌" | "⚠️", "evidence": "explanation" }`;
  },
};
