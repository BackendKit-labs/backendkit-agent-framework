import { spawnSync } from 'child_process';
import { defineTool, z } from '@bk/agent-core';
import { resolveAndCheck } from './path-sandbox';

export const searchFilesTool = defineTool({
    name: 'search_files',
    description: 'Search for text patterns across files using grep. Returns matching lines with file paths and line numbers.',
    input: z.object({
        pattern:          z.string().describe('Regex or literal pattern to search for'),
        path:             z.string().optional().describe('Directory or file to search in (default: working dir)'),
        glob:             z.string().optional().describe('File glob filter (e.g. "*.ts", "**/*.json")'),
        case_insensitive: z.boolean().default(false).describe('Case-insensitive search'),
    }),
    execute: async ({ pattern, path, glob, case_insensitive }, ctx) => {
        const cwd = ctx.workingDir ?? process.cwd();
        const searchPath = path ? resolveAndCheck(cwd, path) : cwd;

        // Build args array — safe from shell injection because we never concatenate into a string
        const args: string[] = ['-rn', '--include', glob ?? '*'];
        if (case_insensitive) args.push('-i');
        args.push('--', pattern, searchPath);  // '--' prevents pattern being parsed as a flag

        const result = spawnSync('grep', args, {
            encoding: 'utf-8',
            maxBuffer: 5 * 1024 * 1024,
        });

        if (result.error) {
            return `Error: grep not available: ${result.error.message}`;
        }
        if (result.status === 1) return '(no matches found)';
        if (result.status !== 0) return `Error: grep exited with status ${result.status}: ${result.stderr}`;

        const lines = (result.stdout ?? '').trim().split('\n').filter(Boolean);
        return lines.slice(0, 200).join('\n') + (lines.length > 200 ? `\n[${lines.length - 200} more results]` : '');
    },
});
