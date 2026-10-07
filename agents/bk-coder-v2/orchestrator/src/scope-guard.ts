import * as fs   from 'node:fs';
import * as path from 'node:path';

// ── File snapshotting ────────────────────────────────────────────────────────
//
// Detects what an agent actually touched during a call, independent of git
// (test/generated projects aren't always git repos) and independent of how the
// touch happened (write_file, edit_file, or a shell command that slipped past
// the destructive-command blocklist, e.g. `git rm`). A mtime-based snapshot
// diff catches the RESULT regardless of the vector.

export type FileSnapshot = Record<string, number>;   // relative path (posix) -> mtimeMs

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.turbo', 'out']);

export function snapshotFiles(projectRoot: string): FileSnapshot {
    const out: FileSnapshot = {};

    function walk(dir: string): void {
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }   // race or permission issue — skip, don't crash the phase over this

        for (const e of entries) {
            // Skip dotfiles/dirs EXCEPT the ones the SDD pipeline itself writes to
            // (.specs, .qa, .security) — those are expected to change every phase.
            if (e.name.startsWith('.') && !['.specs', '.qa', '.security'].includes(e.name)) continue;
            if (IGNORE_DIRS.has(e.name)) continue;

            const full = path.join(dir, e.name);
            if (e.isDirectory()) { walk(full); continue; }

            try {
                out[path.relative(projectRoot, full).split(path.sep).join('/')] = fs.statSync(full).mtimeMs;
            } catch { /* file disappeared mid-walk — fine, just skip it */ }
        }
    }

    walk(projectRoot);
    return out;
}

export interface ScopeDiff {
    added:    string[];
    modified: string[];
    deleted:  string[];
}

export function diffSnapshots(before: FileSnapshot, after: FileSnapshot): ScopeDiff {
    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];

    for (const [p, mtime] of Object.entries(after)) {
        if (!(p in before)) added.push(p);
        else if (before[p] !== mtime) modified.push(p);
    }
    for (const p of Object.keys(before)) {
        if (!(p in after)) deleted.push(p);
    }

    return { added, modified, deleted };
}

// ── Declared scope ────────────────────────────────────────────────────────────

/**
 * Extracts file paths declared under a "Files to create:" heading in a ROADMAP
 * phase body (see design.ts's ROADMAP_SYSTEM prompt for the expected format).
 * Best-effort text matching — returns [] if the section isn't found, in which
 * case scope checking is skipped entirely (nothing to compare against).
 */
export function extractDeclaredFiles(phaseBody: string): string[] {
    // Heading is markdown-bold in practice (design.ts's ROADMAP_SYSTEM prompt emits
    // "**Files to create:**") — tolerate the asterisks on both sides of the colon.
    const section = /files to create:?\*{0,2}\s*\n((?:\s*[-*].+\n?)+)/i.exec(phaseBody)?.[1] ?? '';
    const paths: string[] = [];
    const re = /`([^`]+)`/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(section))) paths.push(m[1].split('\\').join('/'));
    return paths;
}

function isDeclared(touchedPath: string, declared: string[]): boolean {
    return declared.some(d => touchedPath === d || touchedPath.endsWith(`/${d}`) || d.endsWith(`/${touchedPath}`));
}

// ── Reporting ─────────────────────────────────────────────────────────────────

export interface ScopeReport {
    /** True when files were deleted — the caller should treat this as an automatic NO_GO. */
    hasDeletions:  boolean;
    /** Human-readable summary, or undefined when nothing worth reporting happened. */
    summary?:      string;
}

/**
 * Compares what actually changed against what a phase declared it would touch.
 * `declared` empty (no "Files to create" section, or an ad-hoc task with no
 * ROADMAP) means scope can't be judged — only deletions are still flagged,
 * since deleting files is never expected regardless of declared scope.
 */
export function buildScopeReport(diff: ScopeDiff, declared: string[]): ScopeReport {
    const touched = [...diff.added, ...diff.modified];
    const unexpected = declared.length > 0
        ? touched.filter(p => !isDeclared(p, declared))
        : [];

    if (diff.deleted.length === 0 && unexpected.length === 0) {
        return { hasDeletions: false };
    }

    const lines: string[] = [];

    if (diff.deleted.length > 0) {
        lines.push(
            `❗ ${diff.deleted.length} archivo(s) BORRADO(S) durante esta fase — nunca esperado, sin importar el vector:`,
            ...diff.deleted.slice(0, 15).map(p => `  - ${p}`),
        );
    }

    if (unexpected.length > 0) {
        lines.push(
            (lines.length ? '\n' : '') +
            `⚠️ ${unexpected.length} archivo(s) tocado(s) fuera de lo declarado en "Files to create":`,
            ...unexpected.slice(0, 15).map(p => `  - ${p}`),
        );
    }

    return { hasDeletions: diff.deleted.length > 0, summary: lines.join('\n') };
}
