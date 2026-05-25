import { readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import type { ToolDefinition, ExecutionContext } from '@bk/agent-core';

function listRecursive(dir: string, depth: number, maxDepth: number): string[] {
    if (depth > maxDepth) return [];
    const entries = readdirSync(dir, { withFileTypes: true });
    const lines: string[] = [];
    for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const indent = '  '.repeat(depth);
        if (entry.isDirectory()) {
            lines.push(`${indent}${entry.name}/`);
            lines.push(...listRecursive(join(dir, entry.name), depth + 1, maxDepth));
        } else {
            lines.push(`${indent}${entry.name}`);
        }
    }
    return lines;
}

export const listDirectoryTool: ToolDefinition = {
    name: 'list_directory',
    description: 'List files and directories recursively',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Directory path to list' },
            max_depth: { type: 'number', description: 'Max recursion depth (default: 3)' },
        },
        required: ['path'],
    },
    async execute(args: unknown, ctx: ExecutionContext) {
        const { path: inputPath, max_depth = 3 } = args as { path: string; max_depth?: number };
        const path = resolve(ctx.workingDir ?? process.cwd(), inputPath);
        try {
            const stat = statSync(path);
            if (!stat.isDirectory()) return readFileSync_fallback(path);
            const lines = listRecursive(path, 0, max_depth);
            return lines.join('\n') || '(empty directory)';
        } catch (err) {
            throw new Error(`Cannot list "${path}": ${(err as Error).message}`);
        }
    },
};

function readFileSync_fallback(path: string): string {
    return `${path} (file, not a directory)`;
}
