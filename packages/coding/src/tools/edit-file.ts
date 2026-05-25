import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import type { ToolDefinition, ExecutionContext } from '@bk/agent-core';

export const editFileTool: ToolDefinition = {
    name: 'edit_file',
    description: 'Replace an exact string in a file. Safer than write_file for partial edits.',
    parameters: {
        type: 'object',
        properties: {
            file_path: { type: 'string', description: 'Absolute path to the file' },
            old_string: { type: 'string', description: 'Exact text to replace (must be unique in the file)' },
            new_string: { type: 'string', description: 'Replacement text' },
            replace_all: { type: 'boolean', description: 'Replace all occurrences. Default: false' },
        },
        required: ['file_path', 'old_string', 'new_string'],
    },
    async execute(args: unknown, ctx: ExecutionContext) {
        const { file_path, old_string, new_string, replace_all } = args as {
            file_path: string;
            old_string: string;
            new_string: string;
            replace_all?: boolean;
        };

        const abs = resolve(ctx.workingDir ?? process.cwd(), file_path);

        let content: string;
        try {
            content = readFileSync(abs, 'utf-8');
        } catch (err) {
            throw new Error(`Cannot read "${abs}": ${(err as Error).message}`);
        }

        if (!content.includes(old_string)) {
            throw new Error(`old_string not found in "${abs}"`);
        }

        if (!replace_all) {
            const occurrences = content.split(old_string).length - 1;
            if (occurrences > 1) {
                throw new Error(`old_string appears ${occurrences} times in "${abs}". Use replace_all: true or provide more context.`);
            }
        }

        const updated = replace_all
            ? content.split(old_string).join(new_string)
            : content.replace(old_string, new_string);

        writeFileSync(abs, updated, 'utf-8');
        return `Edited: ${abs}`;
    },
};
