import { resolve, dirname, join, sep, relative } from 'path';
import { readFileSync, realpathSync } from 'fs';

/**
 * Resolves `filePath` relative to `workingDir` and verifies the result
 * is contained within `workingDir`. Throws on path traversal attempts.
 *
 * Uses prefix comparison instead of relative() to correctly handle cross-drive
 * paths (D:\outside) and UNC paths (\\server\share) on Windows, where relative()
 * returns an absolute path that does not start with '..'.
 */
/**
 * Resolves `filePath` and verifies it is contained within one of the allowed
 * roots: `workingDir` (primary) or any `additionalRoots` (e.g. the agent's
 * memory directory at ~/.{appName}/projects/{key}).
 * Throws on path traversal attempts outside all allowed roots.
 *
 * The containment check uses the REAL path: a symlink inside the working dir that
 * points outside (workingDir/link -> /etc) cannot be used to escape the sandbox.
 */
export function resolveAndCheck(
    workingDir: string | undefined,
    filePath: string,
    additionalRoots: string[] = [],
): string {
    const cwd = workingDir ?? process.cwd();
    const abs = resolve(cwd, filePath);
    // Real paths for the containment check. A target that does not exist yet (a new
    // file) resolves through its nearest existing ancestor.
    const absReal = realTarget(abs);
    const roots = [cwd, ...additionalRoots].map(realpathSafe);

    // Normalize separators to forward slashes before comparison so that
    // mixed-slash paths (workingDir passed as C:/... but resolve() returns C:\...)
    // don't cause false-negative containment checks on Windows.
    const norm = (p: string) => {
        const s = process.platform === 'win32' ? p.toLowerCase() : p;
        return s.replace(/\\/g, '/');
    };

    const isInside = (root: string) => {
        const prefix = norm(root).endsWith('/') ? norm(root) : norm(root) + '/';
        return norm(absReal) === norm(root) || norm(absReal).startsWith(prefix);
    };

    if (roots.some(isInside)) return abs;

    throw new Error(
        `Access denied: "${filePath}" resolves outside the working directory. ` +
        `Path traversal or symlink escape is not allowed.`
    );
}

function realpathSafe(p: string): string {
    try {
        return realpathSync(p);
    } catch {
        return p; // does not exist yet: compare lexically
    }
}

/** Real path of the target; when it does not exist, of its nearest existing ancestor. */
function realTarget(abs: string): string {
    try {
        return realpathSync(abs);
    } catch {
        /* the target does not exist yet */
    }
    let dir = dirname(abs);
    let prev = '';
    while (dir !== prev) {
        prev = dir;
        try {
            return join(realpathSync(dir), relative(dir, abs));
        } catch {
            dir = dirname(dir);
        }
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
/** Is the directory the repository of THIS framework? Its packages/core/package.json names @backendkit-labs/agent-core. */
function isFrameworkRepo(root: string): boolean {
    try {
        const pkg = JSON.parse(readFileSync(join(root, 'packages', 'core', 'package.json'), 'utf-8')) as { name?: unknown };
        return pkg.name === '@backendkit-labs/agent-core';
    } catch {
        return false;
    }
}

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

    // A path that merely LOOKS like the framework's (any monorepo has a packages/core/src of its own) is the user's code: protect only the
    // repository of this framework, recognised by the package that is in packages/core of the directory the segment hangs from.
    const at = absNorm.indexOf(triggered.replace(/\\/g, '/').toLowerCase());
    if (!isFrameworkRepo(abs.slice(0, at))) return undefined;

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
