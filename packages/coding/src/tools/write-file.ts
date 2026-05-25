import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { ToolDefinition } from '@bk/agent-core';

export const writeFileTool: ToolDefinition = {
    name: 'write_file',
    description: 'Write or overwrite a file with the given content. Creates parent directories if needed.',
    parameters: {
        type: 'object',
        properties: {
            file_path: { type: 'string', description: 'Absolute path to the file' },
            content: { type: 'string', description: 'Content to write' },
        },
        required: ['file_path', 'content'],
    },
    async execute(args: unknown) {
        const { file_path, content } = args as { file_path: string; content: string };
        try {
            mkdirSync(dirname(file_path), { recursive: true });
            writeFileSync(file_path, content, 'utf-8');
            return `Written: ${file_path}`;
        } catch (err) {
            throw new Error(`Cannot write "${file_path}": ${(err as Error).message}`);
        }
    },
};
