import { resolve, relative } from 'path';

/**
 * Resolves `filePath` relative to `workingDir` and verifies the result
 * is contained within `workingDir`. Throws on path traversal attempts.
 */
export function resolveAndCheck(workingDir: string | undefined, filePath: string): string {
    const cwd = workingDir ?? process.cwd();
    const abs = resolve(cwd, filePath);

    const rel = relative(cwd, abs);
    if (rel.startsWith('..') || rel.startsWith('/') || rel.startsWith('\\')) {
        throw new Error(
            `Access denied: "${filePath}" resolves outside the working directory. ` +
            `Path traversal is not allowed.`
        );
    }

    return abs;
}
