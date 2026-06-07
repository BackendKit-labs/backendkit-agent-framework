import { readFileSync } from 'fs';
import { defineTool, z } from '@backendkit-labs/agent-core';
import { resolveAndCheck } from './path-sandbox';

export const readFileTool = defineTool({
    name: 'read_file',
    description: [
        'Read the contents of a file.',
        'Allowed roots: the active working directory and the agent memory directory (~/.{appName}/projects/{key}/).',
        'Use relative paths for project files; use the full path for memory files (e.g. memory/session.md).',
    ].join(' '),
    input: z.object({
        file_path: z.string().describe('Relative path (project file) or full path (memory file)'),
    }),
    execute: async ({ file_path }, ctx) => {
        try {
            const abs = resolveAndCheck(ctx.workingDir, file_path, ctx.additionalRoots ?? []);
            return readFileSync(abs, 'utf-8');
        } catch (err) {
            return `Error: ${(err as Error).message}`;
        }
    },
});
