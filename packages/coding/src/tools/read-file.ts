import { closeSync, fstatSync, openSync, readSync } from 'fs';
import { defineTool, z } from '@backendkit-labs/agent-core';
import { resolveAndCheck } from './path-sandbox';
import { sandboxPathError } from './sandbox-path';

/** A file bigger than this is returned truncated, so one read cannot fill the model's context or the heap. */
export const MAX_READ_BYTES = 1024 * 1024;

export const readFileTool = defineTool({
    name: 'read_file',
    readOnly: true,
    concurrencySafe: true,
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
            const denied = sandboxPathError(ctx, 'read_file', abs, 'read');
            if (denied) return denied;
            const fd = openSync(abs, 'r');
            try {
                const size = fstatSync(fd).size;
                const buf = Buffer.alloc(Math.min(size, MAX_READ_BYTES));
                const n = readSync(fd, buf, 0, buf.length, 0);
                const text = buf.subarray(0, n).toString('utf-8');
                return size > MAX_READ_BYTES
                    ? `${text}

[truncated: showing the first ${MAX_READ_BYTES} of ${size} bytes]`
                    : text;
            } finally { closeSync(fd); }
        } catch (err) {
            return `Error: ${(err as Error).message}`;
        }
    },
});
