import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { defineTool, z } from '@backendkit-labs/agent-core';
import { resolveAndCheck } from './path-sandbox';
import { sandboxPathError } from './sandbox-path';

function listRecursive(dir: string, depth: number, maxDepth: number): string[] {
    if (depth > maxDepth) return [];
    const lines: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
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

export const listDirectoryTool = defineTool({
    name: 'list_directory',
    concurrencySafe: true,
    description: 'List files and directories inside the working directory, recursively.',
    input: z.object({
        path:      z.string().describe('Directory path to list'),
        max_depth: z.number().int().min(1).max(10).default(3).describe('Max recursion depth (default: 3)'),
    }),
    execute: async ({ path: inputPath, max_depth }, ctx) => {
        try {
            const abs = resolveAndCheck(ctx.workingDir, inputPath, ctx.additionalRoots ?? []);
            const denied = sandboxPathError(ctx, 'list_directory', abs, 'read');
            if (denied) return denied;
            const stat = statSync(abs);
            if (!stat.isDirectory()) return `${abs} (file, not a directory)`;
            const lines = listRecursive(abs, 0, max_depth);
            return lines.join('\n') || '(empty directory)';
        } catch (err) {
            return `Error: ${(err as Error).message}`;
        }
    },
});
