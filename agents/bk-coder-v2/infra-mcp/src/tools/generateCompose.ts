import { z } from 'zod';
import type { AgentToolDef } from '@backendkit-labs/mcp-server';

export const generateComposeSchema = {
  projectRoot: z.string().describe('Ruta raíz del proyecto'),
  stack: z.string().describe('Stack tecnológico'),
  services: z.array(z.string()).describe('Servicios adicionales (postgres, redis, mongo, etc.)'),
  exposePort: z.number().optional().describe('Puerto de la aplicación (default: 3000)'),
};

export const generateComposeTool: AgentToolDef<typeof generateComposeSchema> = {
  name: 'generate_compose',
  description: 'Genera docker-compose.yml con los servicios necesarios para el proyecto',
  schema: generateComposeSchema,
  buildPrompt: (args: any) => {
    const { projectRoot, stack, services, exposePort } = args;
    const port = exposePort || 3000;

    return `Generate a docker-compose.yml for a ${stack} project.

Services:
- App service (port ${port})
${services.map((s: string) => `- ${s}`).join('\n')}

Requirements:
- Version 3.8
- Named volumes for databases
- Environment variables section
- Health checks where applicable
- Networks for isolation
- Restart policy: unless-stopped

Write to: ${projectRoot}/docker-compose.yml

Return: { "success": true, "path": "docker-compose.yml", "services": ${JSON.stringify(services)} }`;
  },
};
