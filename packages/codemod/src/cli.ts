import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { MoveReport } from './move-imports';
import { TRANSFORMS, findTransform } from './transforms';
import type { Transform } from './transforms';

export interface Io {
    out(line: string): void;
    err(line: string): void;
}

const consoleIo: Io = { out: l => console.log(l), err: l => console.error(l) };

const USAGE = `Usage: codemod <transformation> [path] [--dry-run]
       codemod --list

  <transformation>  what to run (see --list)
  [path]            a folder or a file; default: the current folder
  --dry-run         show what would change and write nothing
  --list            the transformations and the release that asks for each`;

const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', '.git']);

/** The source files under `path` (a file or a folder), leaving out dependencies, build output and declaration files. */
export function collectFiles(path: string): string[] {
    const target = resolve(path);
    if (!existsSync(target)) throw new Error(`path not found: ${path}`);
    // The long form of the path: Windows can hand out 8.3 names (`MAIRON~1.CUE`) that do not match what the folder lists.
    const real = realpathSync.native(target);
    if (statSync(real).isFile()) return [real];
    const files: string[] = [];
    const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) { if (!SKIPPED_DIRS.has(entry.name)) walk(join(dir, entry.name)); }
            else if (entry.isFile() && SOURCE.test(entry.name) && !entry.name.endsWith('.d.ts')) files.push(join(dir, entry.name));
        }
    };
    walk(real);
    return files.sort();
}

/** Runs a transformation over the files: returns the new text of those that change, and what it did. */
export function applyTransform(files: readonly string[], t: Transform): { changed: Map<string, string>; report: MoveReport } {
    const report: MoveReport = { moved: [], flagged: [] };
    const changed = new Map<string, string>();
    for (const file of files) {
        const before = readFileSync(file, 'utf8');
        const after = t.apply(file, before, report);
        if (after !== before) changed.set(file, after);
    }
    return { changed, report };
}

export async function main(argv: string[], io: Io = consoleIo): Promise<number> {
    const flags = new Set(argv.filter(a => a.startsWith('--')));
    const positional = argv.filter(a => !a.startsWith('--'));
    const unknown = [...flags].filter(f => !['--dry-run', '--list', '--help'].includes(f));
    if (unknown.length > 0) { io.err(`unknown option ${unknown[0]}\n${USAGE}`); return 1; }
    if (flags.has('--help') || argv.length === 0) { io.out(USAGE); return argv.length === 0 ? 1 : 0; }

    if (flags.has('--list')) {
        for (const t of TRANSFORMS) io.out(`${t.name}\n  ${t.description}\n  since ${t.since}`);
        return 0;
    }

    const [name, path = '.'] = positional;
    const transform = name ? findTransform(name) : undefined;
    if (!transform) { io.err(`unknown transformation "${name ?? ''}". Run with --list to see them.`); return 1; }

    let files: string[];
    try { files = collectFiles(path); } catch (err) { io.err((err as Error).message); return 1; }

    const { changed, report } = applyTransform(files, transform);
    const dry = flags.has('--dry-run');
    if (!dry) for (const [file, text] of changed) writeFileSync(file, text);

    // Paths in the report are relative to what the user pointed at.
    const real = realpathSync.native(resolve(path));
    const root = statSync(real).isFile() ? real.slice(0, Math.max(real.lastIndexOf('/'), real.lastIndexOf('\\'))) : real;
    const short = (line: string): string => line.split(root + '/').join('').split(root + '\\').join('');
    for (const line of report.moved) io.out(short(line));
    for (const line of report.flagged) io.out(`TODO ${short(line)}`);
    io.out(`${dry ? 'would change' : 'changed'} ${changed.size} file${changed.size === 1 ? '' : 's'}`
        + (report.flagged.length > 0 ? `; ${report.flagged.length} need${report.flagged.length === 1 ? 's' : ''} a decision (search for TODO(codemod))` : ''));
    return 0;
}
