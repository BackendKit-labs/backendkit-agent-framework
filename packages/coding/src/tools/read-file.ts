import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { ToolDefinition, ExecutionContext } from '@bk/agent-core';

export const readFileTool: ToolDefinition = {
    name: 'read_file',
    description: 'Read the contents of a file',
    parameters: {
        type: 'object',
        properties: {
            file_path: { type: 'string', description: 'Absolute or relative path to the file' },
        },
        required: ['file_path'],
    },
    async execute(args: unknown, ctx: ExecutionContext) {
        const { file_path } = args as { file_path: string };
        const abs = resolve(ctx.workingDir ?? process.cwd(), file_path);
        try {
            return readFileSync(abs, 'utf-8');
        } catch (err) {
            throw new Error(`Cannot read "${abs}": ${(err as Error).message}`);
        }
    },
};
