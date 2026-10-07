import { z }                from 'zod';
import type { AgentToolDef } from '@backendkit-labs/mcp-server';

export const executeTaskSchema = {
    projectRoot: z.string().describe('Absolute path to the project root directory'),
    task:        z.string().describe('Free-form infrastructure task description (not tied to a ROADMAP phase)'),
};

export const executeTaskTool: AgentToolDef<typeof executeTaskSchema> = {
    name:        'execute_task',
    description: 'Execute an ad-hoc infrastructure task (not full generation): add a service to docker-compose, adjust a CI step, tweak a K8s manifest, etc.',
    schema:      executeTaskSchema,
    buildPrompt: (args: any) => {
        const { projectRoot, task } = args;

        return `You are a DevOps expert. Task:

${task}

## Step 1 — Orient yourself
Use list_directory on ${projectRoot} to see what infra files already exist (Dockerfile,
docker-compose.yml, .github/workflows/, k8s/) — never assume a top-level \`src/\` for the app
source; check ${projectRoot}/.specs/design.md's "## Project Structure" if it exists.

## Step 2 — Check for existing, related files
Before creating a new infra file, read the existing one first and modify it in place. Don't
create a second Dockerfile/compose file that conflicts with an existing one.

## Step 3 — Do the task
Use write_file for EACH file you create or modify (full content, no placeholders).
Security: non-root, no hardcoded secrets. Reproducibility: pinned versions, not \`:latest\`.

## Step 4 — Return summary
List the files you created/modified.`;
    },
};
