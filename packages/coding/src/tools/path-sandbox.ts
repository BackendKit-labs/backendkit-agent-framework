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
 * Blocks writes to framework source directories when the agent is running in a
 * project context (workingDir is NOT a framework package directory).
 *
 * Returns an error string when protection triggers, undefined when the write
 * is safe.
 *
 * Protection is SKIPPED when:
 * - workingDir itself is inside a protected segment (user is developing the
 *   framework — all writes to framework source are intentional).
 * - workingDir is the monorepo root (user has explicitly scoped to the full
 *   repo; checkFrameworkProtection cannot tell which project they intend to
 *   work on, so it defers to path-sandbox alone and the startup warning).
 */
export function checkFrameworkProtection(abs: string, workingDir: string | undefined): string | undefined {
    if (!workingDir) return undefined;

    const cwdNorm = workingDir.replace(/\\/g, '/').toLowerCase();
    const absNorm = abs.replace(/\\/g, '/').toLowerCase();

    // Skip protection when workingDir IS a framework package directory.
    // The user is deliberately developing the framework.
    const workingOnFramework = PROTECTED_SEGMENTS.some(seg =>
        cwdNorm.includes(seg.replace(/\\/g, '/').toLowerCase())
    );
    if (workingOnFramework) return undefined;

    // Skip protection when the target is not inside a protected segment.
    const triggered = PROTECTED_SEGMENTS.find(seg =>
        absNorm.includes(seg.replace(/\\/g, '/').toLowerCase())
    );
    if (!triggered) return undefined;

    // Skip protection when workingDir is a direct ancestor of the protected
    // segment — i.e., the monorepo root. Use /cwd or WORKING_DIR to narrow scope.
    const triggerNorm = triggered.replace(/\\/g, '/').toLowerCase();
    const isAncestor = triggerNorm.startsWith(cwdNorm.replace(/\\/g, '/')) ||
                       cwdNorm.split('/').length <= 2; // very short path = likely root
    if (isAncestor) return undefined;

    const rel = relative(workingDir, abs).replace(/\\/g, '/');
    return (
        `⛔ Framework protection: "${rel}" is inside a protected source directory. ` +
        `Agents should not modify framework source files while working on a project. ` +
        `Use /cwd <framework-root> or set WORKING_DIR to the repo root if you intend to develop the framework.`
    );
}
