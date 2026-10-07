import { z }                from 'zod';
import type { AgentToolDef } from '@backendkit-labs/mcp-server';

export const executeTaskSchema = {
    projectRoot: z.string().describe('Absolute path to the project root directory'),
    task:        z.string().describe('Free-form task description (not tied to a ROADMAP phase)'),
};

export const executeTaskTool: AgentToolDef<typeof executeTaskSchema> = {
    name:        'execute_task',
    description: 'Execute an ad-hoc backend task (not phase-based). Reads existing files first, writes via write_file, verifies with run_command.',
    schema:      executeTaskSchema,
    buildPrompt: (args: any) => {
        const { projectRoot, task } = args;
        const specsDir = `${projectRoot}/.specs`;

        return `You are a senior backend developer. Task:

${task}

## Step 1 — Orient yourself
Use list_directory on ${projectRoot} to see the actual top-level layout BEFORE creating or
modifying anything — never assume a layout (e.g. don't assume a top-level \`src/\` exists; a
full-stack project may use separate \`backend/\` and \`frontend/\` trees).
If ${specsDir}/design.md exists, read it for the declared "## Project Structure" and any ADRs.
If ${specsDir}/specification.md exists, read it for functional requirements.

## Step 2 — Check for existing, related files
Before creating a new file (e.g. a config file, a module), use list_directory / search_files to
check whether an equivalent file already exists. Modify it in place rather than creating a
duplicate or a conflicting second version.

## Step 3 — Do the task
Use write_file for EACH file you create or modify (full content, no placeholders).
TypeScript: strict types, proper error handling. Follow existing conventions in the codebase.

Before importing a symbol from another file (e.g. wiring a barrel \`index.ts\`, or calling a
function defined elsewhere), use read_file on that file FIRST to get its EXACT exported name.
Do NOT guess a name from a naming convention (e.g. don't assume \`fooTool\` when the file might
actually export \`getFooTool\`) — an import of a name that doesn't exist fails the build silently
until compile time.

## Step 4 — Verify your work
If a build/test command applies (check package.json scripts), run it with run_command and fix
any errors it reports.

## Step 5 — Return summary
Return a brief summary: which files you created/modified/deleted, and whether verification passed.`;
    },
};
