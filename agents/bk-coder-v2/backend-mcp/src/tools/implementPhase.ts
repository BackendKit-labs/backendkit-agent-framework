import { z }                from 'zod';
import type { AgentToolDef } from '@backendkit-labs/mcp-server';

export const implementPhaseSchema = {
    projectRoot:    z.string().describe('Absolute path to the project root directory'),
    phaseNumber:    z.number().int().min(1).describe('Phase number to implement'),
    phaseTitle:     z.string().describe('Title of the phase'),
    criteria:       z.array(z.string()).describe('Completion criteria for this phase'),
    reworkFindings: z.string().optional().describe('QA findings from previous attempt (rework mode)'),
};

export const implementPhaseTool: AgentToolDef<typeof implementPhaseSchema> = {
    name:        'implement_phase',
    description: 'Implement a specific phase of the project ROADMAP. Reads spec/roadmap, writes all required files using write_file, verifies with run_command.',
    schema:      implementPhaseSchema,
    buildPrompt: (args: any) => {
        const { projectRoot, phaseNumber, phaseTitle, criteria, reworkFindings } = args;
        const specsDir = `${projectRoot}/.specs`;
        const srcDir   = `${projectRoot}/src`;

        return `You are a senior backend developer implementing Phase ${phaseNumber}: "${phaseTitle}".

## Step 1 — Read specification and roadmap
Use read_file to read:
- ${specsDir}/specification.md
- ${specsDir}/ROADMAP.md
- ${specsDir}/progress.md (if it exists — shows what previous phases built)

## Step 2 — Understand existing code
Use list_directory on ${srcDir} to see what files already exist.
Read the most relevant ones to understand the current state.

## Step 3 — Implement the phase
Completion criteria to fulfill:
${criteria.map((c: string, i: number) => `${i + 1}. ${c}`).join('\n')}

${reworkFindings ? `⚠️  REWORK MODE — Fix these issues from the previous QA review:\n${reworkFindings}\n` : ''}

Rules:
- Use write_file for EACH file you create or modify (full content, no placeholders)
- Paths are relative to ${projectRoot} (e.g. src/auth/auth.service.ts)
- Write ALL files needed: models, services, controllers, tests, config files
- TypeScript: strict types, proper error handling
- Follow the architecture decisions in specification.md and design.md

## Step 4 — Verify your work
After writing all files, run:
  run_command("cd ${projectRoot} && npm run build") — or the appropriate build command for the stack
If the build fails, fix the errors and rewrite the affected files.

## Step 5 — Return summary
Return a brief summary: which files you created/modified and whether the build passed.`;
    },
};
