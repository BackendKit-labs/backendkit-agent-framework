import { z } from 'zod';
import type { AgentToolDef } from '@backendkit-labs/mcp-server';

export const generateDockerSchema = {
  projectRoot: z.string().describe('Ruta raíz del proyecto'),
  stack: z.string().describe('Stack tecnológico (node, python, go, java, etc.)'),
  nodeVersion: z.string().optional().describe('Versión de Node.js (default: 20)'),
  exposePort: z.number().optional().describe('Puerto a exponer (default: 3000)'),
};

export const generateDockerTool: AgentToolDef<typeof generateDockerSchema> = {
  name: 'generate_docker',
  description: 'Genera un Dockerfile optimizado para el proyecto basado en su stack tecnológico',
  schema: generateDockerSchema,
  buildPrompt: (args: any) => {
    const { projectRoot, stack, nodeVersion, exposePort } = args;
    const port = exposePort || 3000;
    const nodeVer = nodeVersion || '20';

    return `Generate a production-ready Dockerfile for a ${stack} project.

Requirements:
- Base image: appropriate for ${stack} (node:${nodeVer}-alpine for Node.js)
- Multi-stage build (builder + production)
- Expose port ${port}
- Non-root user for security
- Optimized layer caching
- Minimal image size
- HEALTHCHECK instruction

Write the Dockerfile to: ${projectRoot}/Dockerfile

Return: { "success": true, "path": "Dockerfile", "content": "..." }`;
  },
};
