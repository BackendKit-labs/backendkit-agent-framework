import { z } from 'zod';
import type { AgentToolDef } from '@backendkit-labs/mcp-server';

export const implementFeatureSchema = {
  specPath: z.string().describe('Ruta al specification.md'),
  roadmapPath: z.string().describe('Ruta al ROADMAP.md'),
  currentPhase: z.number().int().min(1).describe('Número de fase a implementar'),
  vaultNamespace: z.string().describe('Namespace del vault para consultar expertise'),
};

export const implementFeatureTool: AgentToolDef<typeof implementFeatureSchema> = {
  name: 'implement_feature',
  description: 'Lee specPath y roadmapPath, implementa la fase actual del ROADMAP en projectRoot/src/ usando el LLM',
  schema: implementFeatureSchema,
  buildPrompt: (args: any) => {
    const { specPath, roadmapPath, currentPhase, vaultNamespace } = args;
    return `You are a senior backend developer implementing Phase ${currentPhase} of a project.

## Instructions
1. Read the specification file at: ${specPath}
2. Read the roadmap file at: ${roadmapPath}
3. Implement Phase ${currentPhase}
4. Use vault expertise from namespace: ${vaultNamespace}

## Requirements
- Clean architecture and SOLID principles
- TypeScript best practices
- Proper error handling
- Unit testability

## Output Format
For each file you create, output:
\`\`\`files
path/to/file.ts
\`\`\`typescript
// file content
\`\`\`

After generating code, save learning:
- learn_pattern: what pattern was used
- save_knowledge: key decisions made

Return a JSON summary:
{
  "phase": ${currentPhase},
  "filesCreated": ["path/to/file.ts"],
  "filesModified": [],
  "summary": "description of what was implemented"
}`;
  },
};
