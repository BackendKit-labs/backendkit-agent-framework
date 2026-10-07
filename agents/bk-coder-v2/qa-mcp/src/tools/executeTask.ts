import { z }                from 'zod';
import type { AgentToolDef } from '@backendkit-labs/mcp-server';

export const executeTaskSchema = {
    projectRoot: z.string().describe('Absolute path to the project root directory'),
    task:        z.string().describe('Free-form QA task description (not tied to a ROADMAP phase)'),
};

export const executeTaskTool: AgentToolDef<typeof executeTaskSchema> = {
    name:        'execute_task',
    description: 'Execute an ad-hoc QA task (not phase-based): run/verify tests, author missing test files, review specific code, or investigate a bug. Uses real files, not guesses.',
    schema:      executeTaskSchema,
    buildPrompt: (args: any) => {
        const { projectRoot, task } = args;
        const specsDir = `${projectRoot}/.specs`;

        return `You are an independent QA engineer. Task:

${task}

## Step 0 — Decide the task TYPE first
- If the task asks you to CREATE, WRITE, or AUTHOR test files (e.g. "create the missing tests
  for X", "add unit tests for Y") — this is an AUTHORING task. Go to "Authoring mode" below.
  Writing a .md report instead of the requested .test.ts/.test.js files does NOT satisfy this
  kind of task, even if reporting is your usual habit.
- If the task asks you to VALIDATE, REVIEW, VERIFY, or RUN existing tests/code — this is a
  VALIDATION task. Go to "Validation mode" below.
- If unsure, prefer Authoring mode when the task explicitly names files that don't exist yet.

## Step 1 — Orient yourself
Use list_directory on ${projectRoot} to see the actual top-level layout — never assume a
top-level \`src/\` exists. If ${specsDir}/specification.md or ${specsDir}/design.md exist, read
them for acceptance criteria and the declared "## Project Structure".

## Authoring mode (writing test files)
- Use write_file to create the REAL test file(s) the task names, with actual test code (real
  assertions against the real implementation) — not a report about tests.
- Before writing a test for a module, use read_file on that module first to get its EXACT
  exported symbol names and signatures. Do NOT guess a name from a naming convention (e.g. don't
  assume \`fooTool\` when the file might export \`getFooTool\`) — an import of a name that doesn't
  exist fails the build.
- Match the test framework already used by sibling test files in the same directory (read one
  existing test file first, e.g. via list_directory + read_file, to see the import style used —
  vitest vs jest vs node:test). Do not introduce a different framework than what's already there.
- If a build/test command applies, run it with run_command afterward to confirm the new file
  actually compiles and runs.

## Validation mode (reviewing/verifying, not authoring)
Read the relevant files with read_file — verify against the ACTUAL code, don't guess.
If the task requires running tests or a command, use run_command and report the real output
(exit code, failures) rather than assuming success.
If the task asks you to fix something in existing code, use write_file with the full corrected
content.

## Final step — Return your findings
Be specific: cite file:line for any issue found. State clearly whether the task's goal was met,
and list every file you created or modified.`;
    },
};
