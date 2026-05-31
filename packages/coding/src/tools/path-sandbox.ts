import { resolve, sep, relative } from 'path';

/**
 * Resolves `filePath` relative to `workingDir` and verifies the result
 * is contained within `workingDir`. Throws on path traversal attempts.
 *
 * Uses prefix comparison instead of relative() to correctly handle cross-drive
 * paths (D:\outside) and UNC paths (\\server\share) on Windows, where relative()
 * returns an absolute path that does not start with '..'.
 */
export function resolveAndCheck(workingDir: string | undefined, filePath: string): string {
    const cwd = workingDir ?? process.cwd();
    const abs = resolve(cwd, filePath);

    // Ensure cwd ends with sep so 'C:\work' does not prefix-match 'C:\workspace'
    const cwdPrefix = cwd.endsWith(sep) ? cwd : cwd + sep;

    // Windows paths are case-insensitive — normalize before comparing
    const norm = (p: string) => process.platform === 'win32' ? p.toLowerCase() : p;

    if (norm(abs) !== norm(cwd) && !norm(abs).startsWith(norm(cwdPrefix))) {
        throw new Error(
            `Access denied: "${filePath}" resolves outside the working directory. ` +
            `Path traversal is not allowed.`
        );
    }

    return abs;
}

/**
 * Framework-level directory segments that agents must never modify.
 * These are core source directories — writing to them from a project context
 * would corrupt the framework itself.
 *
 * Checked as relative path segments so they work regardless of where the
 * monorepo is installed.
 */
const PROTECTED_SEGMENTS = [
    'packages/core/src',
    'packages/coding/src',
    'packages/mcp-server/src',
    'packages\\core\\src',
    'packages\\coding\\src',
    'packages\\mcp-server\\src',
];

/**
 * Warns when the resolved path falls inside a protected framework directory.
 * Returns a warning string when protection is triggered, undefined otherwise.
 *
 * This is a soft guard (warn, not throw) because there are legitimate cases
 * where an agent DOES work on the framework source. The caller decides whether
 * to block or surface the warning to the user.
 */
export function checkFrameworkProtection(abs: string, workingDir: string | undefined): string | undefined {
    if (!workingDir) return undefined;

    // Only apply when workingDir looks like a project subdirectory (examples/, apps/, etc.)
    // — not when the user explicitly set workingDir to the framework root itself.
    const rel = relative(workingDir, abs).replace(/\\/g, '/');

    // If the relative path starts with .. it's already outside workingDir (caught above).
    // Here we care about paths like: packages/core/src/... which are siblings inside the root.
    const absNorm = abs.replace(/\\/g, '/').toLowerCase();
    const triggered = PROTECTED_SEGMENTS.find(seg =>
        absNorm.includes(seg.replace(/\\/g, '/').toLowerCase())
    );

    if (!triggered) return undefined;

    return (
        `⛔ Framework protection: "${rel}" is inside a protected source directory (${triggered}). ` +
        `Agents should not modify framework source files while working on a project. ` +
        `If you intended to work on the framework itself, set workingDir to the repo root explicitly.`
    );
}
