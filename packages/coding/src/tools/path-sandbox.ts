import { resolve, sep } from 'path';

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
