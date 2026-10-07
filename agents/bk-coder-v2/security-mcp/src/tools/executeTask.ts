import { z }                from 'zod';
import type { AgentToolDef } from '@backendkit-labs/mcp-server';

export const executeTaskSchema = {
    projectRoot: z.string().describe('Absolute path to the project root directory'),
    task:        z.string().describe('Free-form security task description (not tied to a ROADMAP phase)'),
};

export const executeTaskTool: AgentToolDef<typeof executeTaskSchema> = {
    name:        'execute_task',
    description: 'Execute an ad-hoc security task (not a full-project review): review specific code, fix a vulnerability, or answer a security question.',
    schema:      executeTaskSchema,
    buildPrompt: (args: any) => {
        const { projectRoot, task } = args;

        return `You are a security expert. Task:

${task}

## Step 1 — Orient yourself
Use list_directory on ${projectRoot} to see the actual top-level layout — never assume a
top-level \`src/\` exists. If ${projectRoot}/.specs/design.md exists, read its
"## Project Structure" for the real source tree(s).

## Step 2 — Do the task
Read the relevant files with read_file. Analyze against OWASP Top 10 categories where applicable.
If the task asks you to fix a vulnerability, use write_file with the full corrected content —
never a partial patch or a description of the fix.

## Step 3 — Return your findings
For each issue: severity (critical/high/medium/low), CWE if applicable, file:line, and whether
you fixed it or it needs the user's attention.`;
    },
};
