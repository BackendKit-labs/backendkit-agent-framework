import { readFileSync } from 'fs';
import { defineTool, z } from '@bk/agent-core';
import { resolveAndCheck } from './path-sandbox';

export const readFileTool = defineTool({
    name: 'read_file',
    description: 'Read the contents of a file inside the working directory.',
    input: z.object({
        file_path: z.string().describe('Relative or absolute path to the file'),
    }),
    execute: async ({ file_path }, ctx) => {
        try {
            const abs = resolveAndCheck(ctx.workingDir, file_path);
            return readFileSync(abs, 'utf-8');
        } catch (err) {
            return `Error: ${(err as Error).message}`;
        }
    },
});
