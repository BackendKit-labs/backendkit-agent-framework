import { lstatSync, readlinkSync, realpathSync } from 'fs';
import { basename, dirname, isAbsolute, join, resolve } from 'path';

const MAX_LINK_HOPS = 40;

/**
 * Where `target` really points, symlinks and junctions followed, even when the file (or some of its parent
 * directories) does not exist yet: the nearest existing ancestor is resolved and the missing tail appended.
 * A dangling link on the way is followed to where it WOULD land, so it cannot be used to write outside.
 */
export function realPathOf(target: string, hops = 0): string {
    const abs = resolve(target);
    if (hops > MAX_LINK_HOPS) throw new Error(`too many symbolic links resolving "${target}"`);
    try {
        return realpathSync.native(abs);
    } catch { /* it, or an ancestor, does not exist: handled below */ }

    let isLink = false;
    try { isLink = lstatSync(abs).isSymbolicLink(); } catch { /* not there at all */ }
    if (isLink) {
        // Exists as a link but its target does not: follow it to where it would land.
        const dest = readlinkSync(abs);
        return realPathOf(isAbsolute(dest) ? dest : join(dirname(abs), dest), hops + 1);
    }

    const parent = dirname(abs);
    if (parent === abs) return abs;
    return join(realPathOf(parent, hops + 1), basename(abs));
}

/** Normalised containment test; case-insensitive on Windows, separator-agnostic. */
export function isInside(root: string, target: string): boolean {
    const norm = (p: string) => {
        const s = resolve(p).replace(/\\/g, '/');
        return process.platform === 'win32' ? s.toLowerCase() : s;
    };
    const r = norm(root);
    const t = norm(target);
    return t === r || t.startsWith(r.endsWith('/') ? r : r + '/');
}
