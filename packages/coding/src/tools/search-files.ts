import * as fs from 'fs';
import * as path from 'path';
import { defineTool, z } from '@backendkit-labs/agent-core';
import { resolveAndCheck } from './path-sandbox';
import { sandboxPathError } from './sandbox-path';

const MAX_RESULTS  = 200;
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB — skip binary/large files

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.next', 'build', 'coverage', '__pycache__', '.venv']);

/** Compile a glob pattern to a RegExp that matches file basenames or relative paths. */
function globToRegex(glob: string): RegExp {
    // B2: use \x00 as sentinel for ** to avoid collision with literal spaces in paths
    const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\x00')
        .replace(/\*/g, '[^/\\\\]*')
        .replace(/\?/g, '[^/\\\\]')
        .replace(/\x00/g, '.*');
    return new RegExp(escaped + '$', 'i');
}

function matchesGlob(filePath: string, glob: string | undefined): boolean {
    if (!glob || glob === '*') return true;
    const re = globToRegex(glob);
    return re.test(filePath) || re.test(path.basename(filePath));
}

function walkAndSearch(
    dir: string,
    baseDir: string,
    pattern: RegExp,
    glob: string | undefined,
    results: string[],
): void {
    if (results.length >= MAX_RESULTS) return;

    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
        if (results.length >= MAX_RESULTS) break;
        if (entry.name.startsWith('.') && entry.name !== '.env') continue;

        const fullPath = path.join(dir, entry.name);
        const relPath  = path.relative(baseDir, fullPath);

        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            walkAndSearch(fullPath, baseDir, pattern, glob, results);
        } else if (entry.isFile()) {
            if (!matchesGlob(relPath, glob)) continue;

            let stat: fs.Stats;
            try { stat = fs.statSync(fullPath); } catch { continue; }
            if (stat.size > MAX_FILE_SIZE) continue;

            let content: string;
            try { content = fs.readFileSync(fullPath, 'utf-8'); }
            catch { continue; } // binary file

            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                if (results.length >= MAX_RESULTS) break;
                if (pattern.test(lines[i])) {
                    results.push(`${relPath}:${i + 1}:${lines[i]}`);
                }
            }
        }
    }
}

export const searchFilesTool = defineTool({
    name: 'search_files',
    concurrencySafe: true,
    description:
        'Search for text patterns across files. ' +
        'Returns matching lines with relative file paths and line numbers. ' +
        'Cross-platform — works on Windows, Mac, and Linux without external tools.',
    input: z.object({
        pattern:          z.string().describe('Regex or literal text to search for'),
        path:             z.string().optional().describe('Directory or file to search in (default: working dir)'),
        glob:             z.string().optional().describe('File glob filter (e.g. "*.ts", "**/*.json", "*.{ts,tsx}")'),
        case_insensitive: z.boolean().default(false).describe('Case-insensitive search'),
    }),
    execute: async ({ pattern, path: searchPath, glob, case_insensitive }, ctx) => {
        const cwd        = ctx.workingDir ?? process.cwd();
        let targetPath: string;
        try {
            targetPath = searchPath ? resolveAndCheck(cwd, searchPath) : cwd;
        } catch (err) {
            return `Error: ${(err as Error).message}`;
        }

        const denied = sandboxPathError(ctx, 'search_files', targetPath, 'read');
        if (denied) return denied;

        let regex: RegExp;
        try {
            regex = new RegExp(pattern, case_insensitive ? 'i' : '');
        } catch {
            return `Error: Invalid regex pattern: ${pattern}`;
        }

        // B3: wrap statSync so a missing path returns a clean error
        let stat: fs.Stats;
        try { stat = fs.statSync(targetPath); }
        catch { return `Error: Path not found: ${searchPath ?? cwd}`; }

        const results: string[] = [];

        if (stat.isFile()) {
            // Single file search
            let content: string;
            try { content = fs.readFileSync(targetPath, 'utf-8'); }
            catch { return `Error: Cannot read file: ${searchPath}`; }
            const relPath  = path.relative(cwd, targetPath);
            content.split('\n').forEach((line, i) => {
                if (results.length < MAX_RESULTS && regex.test(line)) {
                    results.push(`${relPath}:${i + 1}:${line}`);
                }
            });
        } else {
            walkAndSearch(targetPath, cwd, regex, glob, results);
        }

        if (results.length === 0) return '(no matches found)';

        const output = results.join('\n');
        return results.length >= MAX_RESULTS
            ? output + `\n[truncated at ${MAX_RESULTS} results]`
            : output;
    },
});
