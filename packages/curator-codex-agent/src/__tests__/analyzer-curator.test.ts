import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { CodeAnalyzer } from '../analyzer.js';
import { DocumentationCurator } from '../documentation-curator.js';
import type { CuratorLLMProvider } from '../providers/types.js';

// pdf-reader uses import.meta (ESM-only), which ts-jest's CJS mode cannot compile.
jest.mock('../pdf-reader.js', () => ({ extractPdfText: jest.fn() }));
import { extractPdfText } from '../pdf-reader.js';
const pdfMock = extractPdfText as jest.MockedFunction<typeof extractPdfText>;

let root: string;
let vault: string;
let src: string;

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'curator3-'));
    vault = path.join(root, 'vault');
    src = path.join(root, 'src');
    await fs.mkdir(vault, { recursive: true });
    await fs.mkdir(src, { recursive: true });
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

/** Fake provider: returns scripted replies in order and records every call. */
function fakeProvider(replies: Array<string | Error>) {
    const calls: Array<{ system: string; user: string }> = [];
    let i = 0;
    const provider: CuratorLLMProvider = {
        async complete(system, user) {
            calls.push({ system, user });
            const r = replies[Math.min(i++, replies.length - 1)];
            if (r instanceof Error) throw r;
            return r;
        },
    };
    return { provider, calls };
}

const codeNote = (over: Record<string, unknown> = {}) => ({
    type: 'componente', area: 'backend', title: 'Retry Helper', resumen: 'retry()', content: '## Uso\nretry(fn)',
    tags: ['retry'], language: 'typescript', exports: ['retry'], depends_on: [], files: [], version: 1, ...over,
});
const docNote = (over: Record<string, unknown> = {}) => ({
    type: 'politica', area: 'rrhh', title: 'Política de Vacaciones', resumen: '20 días', content: '## Reglas', tags: ['rrhh'], ...over,
});
const reply = (notes: unknown[]) => JSON.stringify({ notes });

async function readNote(file: string) { return fs.readFile(file, 'utf-8'); }

describe('DocumentationCurator', () => {
    it('writes a note under <vault>/<area> with frontmatter and the source path', async () => {
        const { provider } = fakeProvider([reply([docNote()])]);
        const curator = new DocumentationCurator({ provider, vaultPath: vault });
        const r = await curator.curateText('texto', 'doc.md', undefined, path.join(src, 'doc.md'));
        expect(r.errors).toEqual([]);
        expect(r.notesWritten).toHaveLength(1);
        const file = r.notesWritten[0];
        expect(path.dirname(file)).toBe(path.join(vault, 'rrhh'));
        expect(path.basename(file)).toMatch(/^\d{4}-\d{2}-\d{2}-politica-de-vacaciones\.md$/);
        const md = await readNote(file);
        expect(md).toContain('title: "Política de Vacaciones"');
        expect(md).toContain('tipo: politica');
        expect(md).toContain('source_ref: "doc.md"');
        expect(md).toContain('## Reglas');
    });

    it('strips code fences, turns ": undefined" into null and drops null optionals', async () => {
        const raw = '```json\n{"notes":[{"type":"decision","area":"legal","title":"T","resumen":"r","content":"c","tags":[],"version": undefined,"expires_at": undefined}]}\n```';
        const { provider } = fakeProvider([raw]);
        const r = await new DocumentationCurator({ provider, vaultPath: vault }).curateText('x', 's');
        expect(r.errors).toEqual([]);
        expect(r.notesWritten).toHaveLength(1);
        const md = await readNote(r.notesWritten[0]);
        expect(md).not.toContain('version:');
        expect(md).not.toContain('expires_at:');
    });

    it('truncates an over-long resumen instead of failing validation', async () => {
        const { provider } = fakeProvider([reply([docNote({ resumen: 'x'.repeat(900) })])]);
        const r = await new DocumentationCurator({ provider, vaultPath: vault }).curateText('x', 's');
        expect(r.errors).toEqual([]);
        expect(await readNote(r.notesWritten[0])).toContain(`resumen: "${'x'.repeat(497)}…"`);
    });

    it('reports an error when the LLM returns invalid JSON or an invalid note', async () => {
        const bad = await new DocumentationCurator({ provider: fakeProvider(['not json']).provider, vaultPath: vault }).curateText('x', 's');
        expect(bad.errors[0]).toMatch(/^LLM call failed/);
        const invalid = await new DocumentationCurator({ provider: fakeProvider([reply([docNote({ area: 'marketing' })])]).provider, vaultPath: vault }).curateText('x', 's');
        expect(invalid.errors[0]).toMatch(/^LLM call failed/);
        expect(invalid.notesWritten).toEqual([]);
    });

    it('reports when the LLM returns no notes', async () => {
        const r = await new DocumentationCurator({ provider: fakeProvider([reply([])]).provider, vaultPath: vault }).curateText('x', 's');
        expect(r.errors[0]).toContain('no notes');
    });

    it('skips (does not overwrite) a note that already exists for the same day and title', async () => {
        const mk = () => new DocumentationCurator({ provider: fakeProvider([reply([docNote()])]).provider, vaultPath: vault });
        const first = await mk().curateText('x', 's');
        const second = await mk().curateText('x', 's');
        expect(first.notesWritten).toHaveLength(1);
        expect(second.notesWritten).toEqual([]);
        expect(second.notesSkipped).toEqual(['Política de Vacaciones']);
    });

    it('replaces previous notes of the same sourcePath', async () => {
        const source = path.join(src, 'doc.md');
        const a = await new DocumentationCurator({ provider: fakeProvider([reply([docNote({ title: 'Versión A' })])]).provider, vaultPath: vault }).curateText('x', 'doc.md', undefined, source);
        const b = await new DocumentationCurator({ provider: fakeProvider([reply([docNote({ title: 'Versión B' })])]).provider, vaultPath: vault }).curateText('x', 'doc.md', undefined, source);
        await expect(fs.access(a.notesWritten[0])).rejects.toThrow();
        await expect(fs.access(b.notesWritten[0])).resolves.toBeUndefined();
    });

    it('truncates input to maxInputChars and forwards the area hint', async () => {
        const { provider, calls } = fakeProvider([reply([docNote()])]);
        await new DocumentationCurator({ provider, vaultPath: vault, maxInputChars: 10 }).curateText('A'.repeat(50), 's', 'finanzas');
        expect(calls[0].user).toContain('A'.repeat(10));
        expect(calls[0].user).not.toContain('A'.repeat(11));
        expect(calls[0].user).toContain('primarily about "finanzas"');
    });

    it('curateFile reads text files and reports unreadable ones', async () => {
        const file = path.join(src, 'policy.txt');
        await fs.writeFile(file, 'contenido');
        const { provider, calls } = fakeProvider([reply([docNote()])]);
        const curator = new DocumentationCurator({ provider, vaultPath: vault });
        expect((await curator.curateFile(file)).notesWritten).toHaveLength(1);
        expect(calls[0].user).toContain('Source: policy.txt');
        const missing = await curator.curateFile(path.join(src, 'nope.txt'));
        expect(missing.errors[0]).toMatch(/^Cannot read file/);
    });

    it('curateFile extracts PDF text and labels the source with the page count', async () => {
        const file = path.join(src, 'norma.pdf');
        pdfMock.mockResolvedValueOnce({ text: 'texto pdf', pages: 3, filename: 'norma.pdf' });
        const { provider, calls } = fakeProvider([reply([docNote()])]);
        const r = await new DocumentationCurator({ provider, vaultPath: vault }).curateFile(file);
        expect(r.notesWritten).toHaveLength(1);
        expect(calls[0].user).toContain('Source: norma.pdf (3 pages)');
        expect(calls[0].user).toContain('texto pdf');
    });

    it('curateFile reports a PDF that cannot be parsed', async () => {
        pdfMock.mockRejectedValueOnce(new Error('bad xref'));
        const r = await new DocumentationCurator({ provider: fakeProvider([reply([docNote()])]).provider, vaultPath: vault }).curateFile(path.join(src, 'broken.pdf'));
        expect(r.errors).toEqual(['Cannot extract PDF text: bad xref']);
    });
});

describe('CodeAnalyzer', () => {
    const write = async (rel: string, content: string) => {
        const full = path.join(src, rel);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, content);
        return { fullPath: full, relativePath: rel.split(path.sep).join('/') };
    };

    it('analyzes a code file and writes frontmatter with language, exports and source_path', async () => {
        const f = await write('retry.ts', 'export function retry() {}');
        const { provider, calls } = fakeProvider([reply([codeNote()])]);
        const r = await new CodeAnalyzer({ provider, vaultPath: vault }).analyzeFile(f.fullPath, f.relativePath);
        expect(r.errors).toEqual([]);
        expect(r.filesAnalyzed).toEqual(['retry.ts']);
        expect(calls[0].user).toContain('Language: typescript');
        const md = await readNote(r.notesWritten[0]);
        expect(path.dirname(r.notesWritten[0])).toBe(path.join(vault, 'backend'));
        expect(md).toContain('language: typescript');
        expect(md).toContain('exports: ["retry"]');
        expect(md).toContain('source_ref: "retry.ts"');
        expect(md).toContain('sources_combined: ["retry.ts"]');
    });

    it('routes .md/.txt/.pdf files to the documentation curator', async () => {
        const f = await write('guide.md', '# guía');
        const { provider, calls } = fakeProvider([reply([docNote()])]);
        const r = await new CodeAnalyzer({ provider, vaultPath: vault }).analyzeFile(f.fullPath, f.relativePath);
        expect(r.notesWritten).toHaveLength(1);
        expect(calls[0].system).toContain('Knowledge Curator');
    });

    it('includes the sibling .md and README in the prompt and in sources_combined', async () => {
        const code = await write('lib/util.ts', 'export const x = 1;');
        const doc = await write('lib/util.md', 'DOC-SIBLING');
        const readme = await write('lib/README.md', 'README-LOCAL');
        const { provider, calls } = fakeProvider([reply([codeNote()])]);
        const r = await new CodeAnalyzer({ provider, vaultPath: vault }).analyzeFile(code.fullPath, code.relativePath, [code, doc, readme]);
        expect(calls[0].user).toContain('DOC-SIBLING');
        expect(calls[0].user).toContain('README-LOCAL');
        expect(await readNote(r.notesWritten[0])).toContain('sources_combined: ["lib/util.ts", "lib/util.md", "lib/README.md"]');
    });

    it('findAssociatedDocs falls back to docs/<name>.md and the root README as context', async () => {
        const code = await write('pkg/engine.ts', 'x');
        const docs = await write('docs/engine-notes.md', 'd');
        const root = await write('README.md', 'r');
        const found = await new CodeAnalyzer({ provider: fakeProvider(['{}']).provider, vaultPath: vault })
            .findAssociatedDocs(code.fullPath, [code, docs, root]);
        expect(found.docFile).toBe(docs.fullPath);
        expect(found.contextFile).toBe(root.fullPath);
        expect(found.readmeFile).toBeUndefined();
    });

    it('caps code at maxInputChars and doc/readme context at 5000/3000 chars', async () => {
        const code = await write('big.ts', 'C'.repeat(100));
        const doc = await write('big.md', 'D'.repeat(6000));
        const readme = await write('README.md', 'R'.repeat(4000));
        const { provider, calls } = fakeProvider([reply([codeNote()])]);
        await new CodeAnalyzer({ provider, vaultPath: vault, maxInputChars: 20 }).analyzeFile(code.fullPath, code.relativePath, [code, doc, readme]);
        const u = calls[0].user;
        expect(u).toContain('C'.repeat(20)); expect(u).not.toContain('C'.repeat(21));
        expect(u).toContain('D'.repeat(5000)); expect(u).not.toContain('D'.repeat(5001));
    });

    it('reports a missing file, an LLM failure and an empty result without writing notes', async () => {
        const f = await write('a.ts', 'x');
        const mk = (replies: Array<string | Error>) => new CodeAnalyzer({ provider: fakeProvider(replies).provider, vaultPath: vault });
        expect((await mk([reply([])]).analyzeFile(path.join(src, 'ghost.ts'), 'ghost.ts')).errors[0]).toMatch(/^Cannot read file/);
        expect((await mk([new Error('boom')]).analyzeFile(f.fullPath, f.relativePath)).errors[0]).toBe('LLM call failed: boom');
        expect((await mk([reply([])]).analyzeFile(f.fullPath, f.relativePath)).errors[0]).toContain('no notes');
        expect(await fs.readdir(vault)).toEqual([]);
    });

    it('re-analysis replaces the notes previously generated from the same file', async () => {
        const f = await write('c.ts', 'x');
        const run = (title: string) => new CodeAnalyzer({ provider: fakeProvider([reply([codeNote({ title })])]).provider, vaultPath: vault }).analyzeFile(f.fullPath, f.relativePath);
        const first = await run('Primer título');
        const second = await run('Segundo título');
        await expect(fs.access(first.notesWritten[0])).rejects.toThrow();
        await expect(fs.access(second.notesWritten[0])).resolves.toBeUndefined();
        expect(await fs.readdir(path.join(vault, 'backend'))).toHaveLength(1);
    });

    it('escapes double quotes in the title frontmatter', async () => {
        const f = await write('q.ts', 'x');
        const r = await new CodeAnalyzer({ provider: fakeProvider([reply([codeNote({ title: 'Usa "retry" bien' })])]).provider, vaultPath: vault }).analyzeFile(f.fullPath, f.relativePath);
        expect(await readNote(r.notesWritten[0])).toContain('title: "Usa \\"retry\\" bien"');
    });
});
