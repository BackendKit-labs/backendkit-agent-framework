import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Largest request body the HTTP servers read (bytes). A request with more is refused with 413 instead of held in memory. */
export const MAX_BODY_BYTES = 1_048_576;

export class BodyTooLargeError extends Error { constructor(max: number) { super(`request body exceeds ${max} bytes`); } }

/** Reads and parses a JSON body, at most `maxBytes`. Empty body = undefined. Throws {@link BodyTooLargeError} or a SyntaxError. */
export async function readJsonBody(req: IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<unknown> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        total += buf.length;
        if (total > maxBytes) throw new BodyTooLargeError(maxBytes);
        chunks.push(buf);
    }
    const raw = Buffer.concat(chunks).toString('utf-8');
    return raw ? JSON.parse(raw) : undefined;
}

/**
 * The answer to a request that failed inside the server. What the client learns is the class of failure (too large, not JSON,
 * ours), never the internal message; the detail goes to `log`.
 */
export function replyRequestError(res: ServerResponse, err: unknown, log: (line: string) => void): void {
    const [status, error] = err instanceof BodyTooLargeError ? [413, err.message]
        : err instanceof SyntaxError ? [400, 'Invalid JSON body']
        : [500, 'Internal server error'];
    if (status === 500) log(`request failed: ${err instanceof Error ? err.message : String(err)}`);
    if (res.headersSent) return;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error }));
}

/**
 * The HTTP server binds to 127.0.0.1, but a web page in the user's browser can still reach it (DNS rebinding,
 * cross-site POST). The rule lives once in agent-core (SPEC-0013 D6); re-exported here for existing imports.
 */
export { isLoopbackRequest } from '@backendkit-labs/agent-core';

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
