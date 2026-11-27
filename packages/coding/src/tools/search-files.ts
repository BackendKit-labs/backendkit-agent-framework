import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { defineTool, z } from '@backendkit-labs/agent-core';
import { resolveAndCheck } from './path-sandbox';
import { sandboxPathError } from './sandbox-path';

const MAX_RESULTS  = 200;
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB — skip binary/large files

/**
 * Budget for the whole search. The pattern comes from the model: a catastrophic one must not hang the agent.
 * `BK_SEARCH_FILES_TIMEOUT_MS` overrides the 5 s default.
 */
/** `.env.example`, `.env.sample`, `.env.template`, `.env.dist`: the shape of a `.env`, with no secrets. */
const ENV_TEMPLATE = /^\.env\.(?:example|sample|template|dist)$/i;
const searchBudgetMs = (): number => Number(process.env.BK_SEARCH_FILES_TIMEOUT_MS) || 5_000;

class SearchTimeoutError extends Error {}

// Lines are matched inside a vm context because a regular expression runs synchronously and cannot be
// interrupted from the outside; the vm `timeout` can. One compiled script, reused for every file.
const matchContext = vm.createContext({ source: '', flags: '', lines: [] as string[] });
const matchScript = new vm.Script(
    '(function () { var r = new RegExp(source, flags); var hits = []; ' +
    'for (var i = 0; i < lines.length; i++) { if (r.test(lines[i])) hits.push(i); } return hits; })()',
);

/** Indexes of the lines that match, or SearchTimeoutError once `deadline` (epoch ms) passes. */
function matchingLines(source: string, flags: string, lines: string[], deadline: number): number[] {
    const left = deadline - Date.now();
    if (left <= 0) throw new SearchTimeoutError();
    const ctx = matchContext as { source: string; flags: string; lines: string[] };
    ctx.source = source;
    ctx.flags = flags;
    ctx.lines = lines;
    try {
        return matchScript.runInContext(matchContext, { timeout: left }) as number[];
    } catch (err) {
        if ((err as { code?: string }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw new SearchTimeoutError();
        throw err;
    } finally {
        ctx.lines = [];
    }
}

type LineMatcher = (lines: string[]) => number[];

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
    match: LineMatcher,
    glob: string | undefined,
    results: string[],
): void {
    if (results.length >= MAX_RESULTS) return;

    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
        if (results.length >= MAX_RESULTS) break;
        // Hidden entries are skipped, `.env` files too: a broad search would pull the secrets in them into the model's
        // context unasked (audit E-07). Reading one on purpose is `read_file`. Templates (`.env.example`...) hold none, so they stay.
        if (entry.name.startsWith('.') && !ENV_TEMPLATE.test(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);
        const relPath  = path.relative(baseDir, fullPath);

        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            walkAndSearch(fullPath, baseDir, match, glob, results);
        } else if (entry.isFile()) {
            if (!matchesGlob(relPath, glob)) continue;

            let stat: fs.Stats;
            try { stat = fs.statSync(fullPath); } catch { continue; }
            if (stat.size > MAX_FILE_SIZE) continue;

            let content: string;
            try { content = fs.readFileSync(fullPath, 'utf-8'); }
            catch { continue; } // binary file

            const lines = content.split('\n');
            for (const i of match(lines)) {
                if (results.length >= MAX_RESULTS) break;
                results.push(`${relPath}:${i + 1}:${lines[i]}`);
            }
        }
    }
}

const timeoutMessage = (pattern: string): string =>
    `Error: search stopped after ${searchBudgetMs() / 1000}s: the pattern is too expensive to evaluate ` +
    `(possible catastrophic backtracking): ${pattern}. Use a simpler pattern.`;

export const searchFilesTool = defineTool({
    name: 'search_files',
    readOnly: true,
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

        const flags = case_insensitive ? 'i' : '';
        try {
            new RegExp(pattern, flags); // syntax check only; it runs inside matchingLines
        } catch {
            return `Error: Invalid regex pattern: ${pattern}`;
        }
        const deadline = Date.now() + searchBudgetMs();
        const match: LineMatcher = (lines) => matchingLines(pattern, flags, lines, deadline);

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
            const lines = content.split('\n');
            try {
                for (const i of match(lines)) {
                    if (results.length >= MAX_RESULTS) break;
                    results.push(`${relPath}:${i + 1}:${lines[i]}`);
                }
            } catch (err) {
                if (err instanceof SearchTimeoutError) return timeoutMessage(pattern);
                throw err;
            }
        } else {
            try {
                walkAndSearch(targetPath, cwd, match, glob, results);
            } catch (err) {
                if (err instanceof SearchTimeoutError) return timeoutMessage(pattern);
                throw err;
            }
        }

        if (results.length === 0) return '(no matches found)';

        const output = results.join('\n');
        return results.length >= MAX_RESULTS
            ? output + `\n[truncated at ${MAX_RESULTS} results]`
            : output;
    },
});
