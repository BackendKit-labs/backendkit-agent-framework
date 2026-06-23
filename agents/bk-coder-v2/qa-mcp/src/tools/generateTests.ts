import { z } from 'zod';
import type { AgentToolDef } from '@backendkit-labs/mcp-server';

export const generateTestsSchema = {
  specPath: z.string().describe('Ruta al specification.md'),
  codePaths: z.array(z.string()).min(1).describe('Rutas de archivos a cubrir con tests'),
};

export const generateTestsTool: AgentToolDef<typeof generateTestsSchema> = {
  name: 'generate_tests',
  description: 'Genera tests faltantes basados en la spec',
  schema: generateTestsSchema,
  buildPrompt: (args: any) => {
    const { specPath, codePaths } = args;
    return `You are a test engineer. Generate unit tests for the following code.

1. Read the specification at: ${specPath}
2. Read the source files:
${codePaths.map((p: string) => `   - ${p}`).join('\n')}

For each source file, create a corresponding test file in __tests__/ directory.
Include tests for: happy path, error cases, edge cases, requirements from the spec.

Output each test file in this format:
\`\`\`files
path/to/__tests__/file.spec.ts
\`\`\`typescript
// test content
\`\`\`

Return a JSON summary:
{
  "testsCreated": ["path/to/__tests__/file.spec.ts"],
  "testFramework": "jest",
  "coverage": 75
}`;
  },
};
