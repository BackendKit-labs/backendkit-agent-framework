import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import type { ToolDefinition, ExecutionContext } from '@bk/agent-core';

export const writeFileTool: ToolDefinition = {
    name: 'write_file',
    description: 'Write or overwrite a file with the given content. Creates parent directories if needed.',
    parameters: {
        type: 'object',
        properties: {
            file_path: { type: 'string', description: 'Absolute or relative path to the file' },
            content: { type: 'string', description: 'Content to write' },
        },
        required: ['file_path', 'content'],
    },
    async execute(args: unknown, ctx: ExecutionContext) {
        const { file_path, content } = args as { file_path: string; content: string };
        const abs = resolve(ctx.workingDir ?? process.cwd(), file_path);
        try {
            mkdirSync(dirname(abs), { recursive: true });
            writeFileSync(abs, content, 'utf-8');
            return `Written: ${abs}`;
        } catch (err) {
            throw new Error(`Cannot write "${abs}": ${(err as Error).message}`);
        }
    },
};
