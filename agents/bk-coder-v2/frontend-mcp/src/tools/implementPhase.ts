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
    description: 'Implement a frontend phase of the project ROADMAP (Next.js/React). Reads spec/roadmap, writes UI files using write_file, verifies with run_command.',
    schema:      implementPhaseSchema,
    buildPrompt: (args: any) => {
        const { projectRoot, phaseNumber, phaseTitle, criteria, reworkFindings } = args;
        const specsDir = `${projectRoot}/.specs`;

        return `You are a senior frontend developer implementing Phase ${phaseNumber}: "${phaseTitle}".

## Step 1 — Read specification, design and roadmap
Use read_file to read:
- ${specsDir}/specification.md
- ${specsDir}/design.md — check "## Project Structure" for the REAL frontend root. A single-domain
  (frontend-only) project uses one \`src/\` at ${projectRoot}; a full-stack project uses a SEPARATE
  top-level \`frontend/\` tree next to \`backend/\` — never assume which one without checking.
- ${specsDir}/ROADMAP.md — this phase's "Files to create" section gives the exact paths to use
- ${specsDir}/progress.md (if it exists — shows what previous phases built)

## Step 2 — Understand the existing UI
Use list_directory on ${projectRoot} first to confirm the top-level layout, then drill into the
frontend root from design.md (app/, components/, services/, lib/, hooks/ live inside it).
Read the most relevant files to understand the current state and the API contract you must consume.

## Step 3 — Implement the phase (FRONTEND ONLY)
Completion criteria to fulfill:
${criteria.map((c: string, i: number) => `${i + 1}. ${c}`).join('\n')}

${reworkFindings ? `⚠️  REWORK MODE — Fix these issues from the previous QA review:\n${reworkFindings}\n` : ''}

Hard rules:
- Build ONLY the frontend: Next.js (App Router) / React components, pages, hooks, a typed service
  layer, and styles. Use write_file for EACH file (full content, no placeholders).
- NEVER write backend/server code. No controllers, no database, no NestJS, no migrations.
  The backend API already exists — consume it through a typed service layer (fetch/axios).
- Keep concerns separated: components (presentational) / hooks / services (API) / lib (utils).
- Strict TypeScript. No business logic in components. Reusable, typed components.
- Paths are relative to ${projectRoot}, using the frontend root from design.md's Project Structure
  (e.g. src/components/AgentCard.tsx for single-domain, or frontend/src/components/AgentCard.tsx
  for full-stack) — never write .tsx files into a backend source tree.
- Before importing a symbol from another file, use read_file on that file FIRST to get its EXACT
  exported name. Do NOT guess a name from a naming convention — a wrong import name fails the build.

## Step 4 — Verify your work
If a build/lint command applies, run it with run_command and fix any errors.

## Step 5 — Return summary
Return a brief summary: which files you created/modified.`;
    },
};
