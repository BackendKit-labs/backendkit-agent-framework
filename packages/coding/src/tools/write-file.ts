import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { defineTool, z, atomicWriteSync } from '@bk/agent-core';
import { resolveAndCheck, checkFrameworkProtection } from './path-sandbox';
import { warnIfSecrets } from './secret-scanner';

export const writeFileTool = defineTool({
    name: 'write_file',
    description: 'Write or overwrite a file inside the working directory. Creates parent directories if needed.',
    input: z.object({
        file_path: z.string().describe('Relative or absolute path to the file'),
        content:   z.string().describe('Content to write'),
    }),
    execute: async ({ file_path, content }, ctx) => {
        try {
            const abs = resolveAndCheck(ctx.workingDir, file_path);
            const fwWarn = checkFrameworkProtection(abs, ctx.workingDir);
            if (fwWarn) return `Error: ${fwWarn}`;
            const warning = warnIfSecrets(abs, content);
            mkdirSync(dirname(abs), { recursive: true });
            atomicWriteSync(abs, content);
            return warning ? `Written: ${abs}\n⚠ ${warning}` : `Written: ${abs}`;
        } catch (err) {
            return `Error: ${(err as Error).message}`;
        }
    },
});
