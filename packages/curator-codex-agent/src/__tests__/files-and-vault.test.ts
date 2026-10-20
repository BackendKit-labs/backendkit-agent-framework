import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    calculateFileHash, createManifest, findAllFiles, hasFileChanged, isCodeFile, isDocFile,
    loadManifest, saveManifest, updateManifestEntry,
} from '../checksum.js';
import {
    deleteNotes, findOrphanedNotes, normalizeSourcePath, readSourcePath, removeNotesForSource,
} from '../vault-dedup.js';

// project.ts imports @backendkit-labs/infra (ESM-only); findNote needs none of it.
jest.mock('@backendkit-labs/infra', () => ({ initBkHome: async () => undefined, bkPaths: { vault: (n: string) => n } }));
// eslint-disable-next-line import/first
import { findNote } from '../project.js';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'curator-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

const put = async (rel: string, content: string) => {
    const p = path.join(dir, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
    return p;
};

describe('checksum', () => {
    it('hash is a stable sha256 of the content', async () => {
        const a = await put('a.txt', 'hello');
        expect(await calculateFileHash(a)).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    it('manifest round-trips and stamps lastUpdated; missing or corrupt manifest -> null', async () => {
        expect(await loadManifest(dir)).toBeNull();
        const m = createManifest('in', 'out');
        m.lastUpdated = '2000-01-01T00:00:00.000Z';
        await saveManifest(dir, m);
        const loaded = await loadManifest(dir);
        expect(loaded).toMatchObject({ version: '1.0', inputPath: 'in', outputPath: 'out' });
        expect(loaded!.lastUpdated).not.toBe('2000-01-01T00:00:00.000Z');
        await fs.writeFile(path.join(dir, '.codex-manifest.json'), '{broken');
        expect(await loadManifest(dir)).toBeNull();
    });

    it('hasFileChanged: true without manifest/entry, false when unchanged, true after edit', async () => {
        const f = await put('src/a.ts', 'v1');
        expect(await hasFileChanged(f, 'src/a.ts', null)).toBe(true);
        const m = createManifest('in', 'out');
        expect(await hasFileChanged(f, 'src/a.ts', m)).toBe(true);
        await updateManifestEntry(m, f, 'src/a.ts', 'success');
        expect(m.files['src/a.ts']).toMatchObject({ status: 'success', size: 2 });
        expect(await hasFileChanged(f, 'src/a.ts', m)).toBe(false);
        await fs.writeFile(f, 'v2!');
        expect(await hasFileChanged(f, 'src/a.ts', m)).toBe(true);
    });

    it('classifies code and doc files case-insensitively', () => {
        expect(isCodeFile('A.TS')).toBe(true);
        expect(isCodeFile('main.go')).toBe(true);
        expect(isCodeFile('notes.md')).toBe(false);
        expect(isDocFile('README.MD')).toBe(true);
        expect(isDocFile('x.pdf')).toBe(true);
        expect(isDocFile('x.png')).toBe(false);
    });

    it('findAllFiles walks recursively, keeps code/doc files, skips hidden dirs and build output', async () => {
        await put('src/a.ts', ''); await put('src/deep/b.py', ''); await put('docs/readme.md', '');
        await put('img/logo.png', '');
        await put('node_modules/x/index.js', ''); await put('dist/out.js', ''); await put('build/o.js', '');
        await put('.git/config.md', ''); await put('.hidden.ts', ''); await put('venv/lib.py', '');
        const found = (await findAllFiles(dir)).map(f => f.relativePath.replace(/\\/g, '/')).sort();
        expect(found).toEqual(['docs/readme.md', 'src/a.ts', 'src/deep/b.py']);
    });

    it('findAllFiles on a missing dir returns [] instead of throwing', async () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        expect(await findAllFiles(path.join(dir, 'nope'))).toEqual([]);
        spy.mockRestore();
    });
});

describe('vault-dedup', () => {
    const note = (sp: string | null, extra = '') =>
        `---\ntitle: T\n${sp !== null ? `source_path: "${sp}"\n` : ''}---\n\nbody${extra}`;

    it('normalizeSourcePath makes absolute paths with forward slashes', () => {
        const n = normalizeSourcePath(path.join(dir, 'a', '..', 'b.ts'));
        expect(n).not.toContain('\\');
        expect(n.endsWith('/b.ts')).toBe(true);
    });

    it.each([
        ['quoted', '---\nsource_path: "C:/x/a.ts"\n---\nb', 'C:/x/a.ts'],
        ['unquoted', '---\nsource_path: /x/a.ts\n---\nb', '/x/a.ts'],
        ['CRLF', '---\r\nsource_path: "/x/a.ts"\r\n---\r\nb', '/x/a.ts'],
        ['absent key', '---\ntitle: T\n---\nb', null],
        ['no frontmatter', 'just text', null],
    ])('readSourcePath %s', (_l, content, expected) => {
        expect(readSourcePath(content)).toBe(expected);
    });

    it('removeNotesForSource deletes only notes from that source, recursively, and counts them', async () => {
        const src = path.join(dir, 'repo', 'a.ts').replace(/\\/g, '/');
        const other = path.join(dir, 'repo', 'b.ts').replace(/\\/g, '/');
        const vault = path.join(dir, 'vault');
        await put('vault/one.md', note(src));
        await put('vault/sub/two.md', note(src, ' v2'));
        await put('vault/keep.md', note(other));
        await put('vault/manual.md', note(null));
        await put('vault/.obsidian/hidden.md', note(src));
        await put('vault/not-md.txt', note(src));

        expect(await removeNotesForSource(vault, src)).toBe(2);
        const left = [
            await fs.access(path.join(vault, 'one.md')).then(() => 1, () => 0),
            await fs.access(path.join(vault, 'sub', 'two.md')).then(() => 1, () => 0),
            await fs.access(path.join(vault, 'keep.md')).then(() => 1, () => 0),
            await fs.access(path.join(vault, 'manual.md')).then(() => 1, () => 0),
            await fs.access(path.join(vault, '.obsidian', 'hidden.md')).then(() => 1, () => 0),
        ];
        expect(left).toEqual([0, 0, 1, 1, 1]);
    });

    it('removeNotesForSource on a missing vault removes nothing', async () => {
        expect(await removeNotesForSource(path.join(dir, 'nope'), '/x/a.ts')).toBe(0);
    });

    it('findOrphanedNotes reports notes whose source is gone; ignores notes without source_path; never deletes', async () => {
        const alive = await put('repo/alive.ts', 'x');
        const gone = path.join(dir, 'repo', 'gone.ts').replace(/\\/g, '/');
        const vault = path.join(dir, 'vault');
        await put('vault/live.md', note(alive.replace(/\\/g, '/')));
        const orphanNote = await put('vault/orphan.md', note(gone));
        await put('vault/manual.md', note(null));

        const orphans = await findOrphanedNotes(vault);
        expect(orphans).toHaveLength(1);
        expect(orphans[0].notePath).toBe(orphanNote);
        expect(orphans[0].sourcePath).toBe(gone);
        await expect(fs.access(orphanNote)).resolves.toBeUndefined();
    });

    it('deleteNotes counts only the files actually removed', async () => {
        const a = await put('a.md', ''); const b = await put('b.md', '');
        expect(await deleteNotes([a, path.join(dir, 'missing.md'), b])).toBe(2);
    });
});

describe('findNote', () => {
    it('finds by title (slug match) and returns the most recently modified', async () => {
        const old = await put('vault/auth-flow-old.md', 'OLD');
        await put('vault/sub/auth-flow-new.md', 'NEW');
        await fs.utimes(old, new Date('2020-01-01'), new Date('2020-01-01'));
        expect(await findNote(path.join(dir, 'vault'), 'Auth Flow')).toBe('NEW');
    });

    it('throws a clear error when no note matches', async () => {
        await put('vault/a.md', 'x');
        await expect(findNote(path.join(dir, 'vault'), 'zzz')).rejects.toThrow(/Note not found in vault: "zzz"/);
    });

    it('reads a note by relative path inside the vault', async () => {
        await put('vault/notes/a.md', 'INSIDE');
        expect(await findNote(path.join(dir, 'vault'), 'notes/a.md')).toBe('INSIDE');
    });

    it('does not read files outside the vault (relative traversal or absolute path)', async () => {
        const secret = await put('secret.md', 'SECRET');
        await put('vault/a.md', 'x');
        const vault = path.join(dir, 'vault');
        await expect(findNote(vault, '../secret.md')).rejects.toThrow(/outside the vault/i);
        await expect(findNote(vault, secret)).rejects.toThrow(/outside the vault/i);
    });

    it('still allows an absolute path that points inside the vault', async () => {
        const inside = await put('vault/in.md', 'IN');
        expect(await findNote(path.join(dir, 'vault'), inside)).toBe('IN');
    });
});
