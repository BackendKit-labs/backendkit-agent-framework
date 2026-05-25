import { readFileSync } from 'fs';
import type { ToolDefinition } from '@bk/agent-core';

export const readFileTool: ToolDefinition = {
    name: 'read_file',
    description: 'Read the contents of a file',
    parameters: {
        type: 'object',
        properties: {
            file_path: { type: 'string', description: 'Absolute path to the file' },
        },
        required: ['file_path'],
    },
    async execute(args: unknown) {
        const { file_path } = args as { file_path: string };
        try {
            return readFileSync(file_path, 'utf-8');
        } catch (err) {
            throw new Error(`Cannot read "${file_path}": ${(err as Error).message}`);
        }
    },
};
