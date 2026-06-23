import { z } from 'zod';
import type { AgentToolDef } from '@backendkit-labs/mcp-server';

export const generateCICDSchema = {
  projectRoot: z.string().describe('Ruta raíz del proyecto'),
  stack: z.string().describe('Stack tecnológico'),
  platform: z.enum(['github-actions', 'gitlab-ci']).optional().describe('Plataforma de CI/CD (default: github-actions)'),
};

export const generateCICDTool: AgentToolDef<typeof generateCICDSchema> = {
  name: 'generate_cicd',
  description: 'Genera configuración de CI/CD (GitHub Actions) para el proyecto',
  schema: generateCICDSchema,
  buildPrompt: (args: any) => {
    const { projectRoot, stack, platform } = args;
    const ciPlatform = platform || 'github-actions';
    const outputPath = ciPlatform === 'github-actions'
      ? `${projectRoot}/.github/workflows/ci.yml`
      : `${projectRoot}/.gitlab-ci.yml`;

    return `Generate a CI/CD pipeline configuration for a ${stack} project using ${ciPlatform}.

Requirements:
- Install dependencies
- Run linting
- Run tests
- Build project
- Cache dependencies for faster runs
- Run on push to main and pull requests
- Node.js 20 (if applicable)

Write to: ${outputPath}

Return: { "success": true, "path": "${outputPath.replace(projectRoot, '').replace(/\\/g, '/').slice(1)}", "platform": "${ciPlatform}" }`;
  },
};
