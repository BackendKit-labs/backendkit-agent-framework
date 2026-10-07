import { z }                from 'zod';
import type { AgentToolDef } from '@backendkit-labs/mcp-server';

export const executeTaskSchema = {
    projectRoot: z.string().describe('Absolute path to the project root directory'),
    task:        z.string().describe('Free-form frontend task description (not tied to a ROADMAP phase)'),
};

export const executeTaskTool: AgentToolDef<typeof executeTaskSchema> = {
    name:        'execute_task',
    description: 'Execute an ad-hoc frontend task (not phase-based). Reads existing files first, writes via write_file, verifies with run_command.',
    schema:      executeTaskSchema,
    buildPrompt: (args: any) => {
        const { projectRoot, task } = args;
        const specsDir = `${projectRoot}/.specs`;

        return `You are a senior frontend developer (Next.js/React). Task:

${task}

## Step 1 — Orient yourself
Use list_directory on ${projectRoot} to see the actual top-level layout BEFORE creating or
modifying anything — never assume a layout. A full-stack project uses a SEPARATE top-level
\`frontend/\` tree next to \`backend/\`; a frontend-only project uses one \`src/\` at ${projectRoot}.
If ${specsDir}/design.md exists, read it for the declared "## Project Structure".

## Step 2 — Check for existing, related files
Before creating a new file (component, hook, service, config), check whether an equivalent file
already exists. Modify it in place rather than creating a duplicate or a conflicting second version.

## Step 3 — Do the task (FRONTEND ONLY)
Use write_file for EACH file you create or modify (full content, no placeholders).
NEVER write backend/server code (no controllers, no database, no ORM). Strict TypeScript.
Keep concerns separated: components (presentational) / hooks / services (API) / lib (utils).

Before importing a symbol from another file (e.g. a component, hook, or service), use read_file
on that file FIRST to get its EXACT exported name. Do NOT guess a name from a naming convention —
a wrong import name fails the build.

## Step 4 — Verify your work
If a build/lint command applies, run it with run_command and fix any errors.

## Step 5 — Return summary
Return a brief summary: which files you created/modified/deleted.`;
    },
};
