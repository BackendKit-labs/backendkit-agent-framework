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

        return `You are a senior backend developer implementing Phase ${phaseNumber}: "${phaseTitle}".

## Step 1 — Read specification, design and roadmap
Use read_file to read:
- ${specsDir}/specification.md
- ${specsDir}/design.md — check "## Project Structure" for the REAL source layout. A single-domain
  project uses one \`src/\`; a full-stack project uses SEPARATE top-level trees, typically
  \`backend/\` and \`frontend/\` — never assume \`src/\` exists at the project root.
- ${specsDir}/ROADMAP.md — this phase's "Files to create" section gives the exact paths to use
- ${specsDir}/progress.md (if it exists — shows what previous phases built)

## Step 2 — Understand existing code
Use list_directory on ${projectRoot} first to see the actual top-level layout, then drill into
the backend source tree declared in design.md's Project Structure (may be \`src/\` or \`backend/src/\`).
Read the most relevant existing files to understand the current state.

## Step 3 — Implement the phase
Completion criteria to fulfill:
${criteria.map((c: string, i: number) => `${i + 1}. ${c}`).join('\n')}

${reworkFindings ? `⚠️  REWORK MODE — Fix these issues from the previous QA review:\n${reworkFindings}\n` : ''}

Rules:
- Use write_file for EACH file you create or modify (full content, no placeholders)
- Paths are relative to ${projectRoot} — use the layout from design.md's Project Structure
  (e.g. src/auth/auth.service.ts for single-domain, or backend/src/auth/auth.service.ts for full-stack)
- Write ALL files needed: models, services, controllers, tests, config files
- TypeScript: strict types, proper error handling
- Follow the architecture decisions in specification.md and design.md
- Before importing a symbol from another file (e.g. wiring a barrel \`index.ts\`, or calling code
  from a previous phase), use read_file on that file FIRST to get its EXACT exported name. Do NOT
  guess a name from a naming convention (e.g. don't assume \`fooTool\` when the file might actually
  export \`getFooTool\`) — a wrong import name fails the build.

## Step 4 — Verify your work
After writing all files, run:
  run_command("cd ${projectRoot} && npm run build") — or the appropriate build command for the stack
If the build fails, fix the errors and rewrite the affected files.

## Step 5 — Return summary
Return a brief summary: which files you created/modified and whether the build passed.`;
    },
};
