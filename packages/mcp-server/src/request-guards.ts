import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * The HTTP server binds to 127.0.0.1, but a web page in the user's browser can still reach it (DNS rebinding,
 * cross-site POST). Reject requests whose Host or Origin is not loopback.
 *
 * Same rule as `isLoopbackRequest` in @backendkit-labs/mcp-connectors (shared/server-runner). It is repeated
 * here because mcp-server must not depend on the connectors package; keep the two in step.
 */
export function isLoopbackRequest(host: string | undefined, origin: string | undefined): boolean {
    if (!host || !LOOPBACK_HOSTS.has(host.replace(/:\d+$/, '').toLowerCase())) return false;
    if (origin === undefined) return true; // non-browser clients send no Origin
    try {
        return LOOPBACK_HOSTS.has(new URL(origin).hostname.toLowerCase().replace(/^(::1)$/, '[::1]'));
    } catch {
        return false;
    }
}

/** Extra directories that may be indexed besides the server's working directory (BK_INDEX_ROOTS, path-delimited). */
export function extraIndexRoots(env: Record<string, string | undefined> = process.env): string[] {
    return (env['BK_INDEX_ROOTS'] ?? '').split(path.delimiter).map(s => s.trim()).filter(Boolean);
}

/**
 * Resolves `requested` against the first root and returns its real path, provided it lies inside one of `roots`.
 * Real paths on both sides, so a symlink inside a root that points elsewhere does not get through.
 * Throws otherwise (or if the directory does not exist).
 */
export async function resolveInside(roots: string[], requested: string): Promise<string> {
    const denied = () => new Error(
        `Access denied: "${requested}" is outside the directories this server may index. ` +
        'Set BK_INDEX_ROOTS to allow more.',
    );
    const inside = (root: string, target: string) => {
        const rel = path.relative(root, target);
        return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    };

    const abs = path.resolve(roots[0], requested);
    let real: string;
    try {
        real = await fs.realpath(abs);
    } catch (err) {
        // a missing directory: say "outside" when that is the reason, so a probe cannot tell what exists out there
        if (!roots.some(r => inside(path.resolve(r), abs))) throw denied();
        throw err;
    }
    for (const root of roots) {
        const realRoot = await fs.realpath(root).catch(() => undefined);
        if (realRoot && inside(realRoot, real)) return real;
    }
    throw denied();
}
