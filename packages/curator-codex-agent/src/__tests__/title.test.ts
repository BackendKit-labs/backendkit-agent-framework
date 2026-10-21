import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { MAX_TITLE, fitTitle, slugify, titleCoherenceWarning, truncateAtWord } from '../title.js';
import { CodeAnalyzer } from '../analyzer.js';
import { DocumentationCurator } from '../documentation-curator.js';
import type { CuratorLLMProvider } from '../providers/types.js';

// pdf-reader uses import.meta (ESM-only); not needed here.
jest.mock('../pdf-reader.js', () => ({ extractPdfText: jest.fn() }));

const LONG = 'Cierre de la auditoría del framework BackendKit: 16 PR mergeados, tests verdes y guardrails de CI activos en todos los packages del monorepo';

function scripted(replies: Array<string | Error>) {
    const calls: Array<{ system: string; user: string; json?: boolean }> = [];
    let i = 0;
    const provider: CuratorLLMProvider = {
        async complete(system, user, opts) {
            calls.push({ system, user, json: opts?.json });
            const r = replies[Math.min(i++, replies.length - 1)];
            if (r instanceof Error) throw r;
            return r;
        },
    };
    return { provider, calls };
}

describe('truncateAtWord', () => {
    it('leaves short text untouched', () => {
        expect(truncateAtWord('corto', 120)).toBe('corto');
    });

    it('cuts at a word boundary, adds an ellipsis and never exceeds max', () => {
        const out = truncateAtWord(LONG, 60);
        expect(out.length).toBeLessThanOrEqual(60);
        expect(out.endsWith('…')).toBe(true);
        const body = out.slice(0, -1);
        expect(LONG.startsWith(body)).toBe(true);
        expect(LONG[body.length]).toBe(' '); // cut fell right before a space, not mid-word
    });

    it('strips trailing punctuation before the ellipsis', () => {
        expect(truncateAtWord('uno dos tres, cuatro cinco', 14)).toBe('uno dos tres…');
    });

    it('falls back to a hard cut when a single word exceeds the limit', () => {
        const out = truncateAtWord('x'.repeat(200), 50);
        expect(out).toHaveLength(50);
        expect(out.endsWith('…')).toBe(true);
    });
});

describe('fitTitle', () => {
    it('does not call the LLM when the title already fits', async () => {
        const { provider, calls } = scripted(['nope']);
        expect(await fitTitle('Título corto', provider)).toBe('Título corto');
        expect(calls).toHaveLength(0);
    });

    it('asks the LLM for a shorter title (plain text, not JSON) and strips quotes', async () => {
        const { provider, calls } = scripted(['"Cierre de la auditoría del framework BackendKit"\nextra line']);
        const out = await fitTitle(LONG, provider);
        expect(out).toBe('Cierre de la auditoría del framework BackendKit');
        expect(calls[0].json).toBe(false);
        expect(calls[0].user).toContain(LONG);
    });

    it('falls back to word-boundary truncation when the LLM answer is still too long', async () => {
        const { provider } = scripted([LONG + ' y más cosas encima']);
        const out = await fitTitle(LONG + ' ' + LONG, provider);
        expect(out.length).toBeLessThanOrEqual(MAX_TITLE);
        expect(out.endsWith('…')).toBe(true);
    });

    it('falls back when the LLM call throws or returns nothing', async () => {
        for (const reply of [new Error('down'), '   ']) {
            const out = await fitTitle(LONG + ' ' + LONG, scripted([reply]).provider);
            expect(out.length).toBeLessThanOrEqual(MAX_TITLE);
            expect(out.endsWith('…')).toBe(true);
        }
    });
});

describe('slugify', () => {
    it('removes accents and symbols', () => {
        expect(slugify('Política de Vacaciones (2026)!')).toBe('politica-de-vacaciones-2026');
    });

    it('cuts at a hyphen, never mid-word, and leaves no trailing hyphen', () => {
        const s = slugify('cierre de auditoria del framework backendkit con dieciseis pr mergeados');
        expect(s.length).toBeLessThanOrEqual(60);
        expect(s.endsWith('-')).toBe(false);
        expect('cierre-de-auditoria-del-framework-backendkit-con-dieciseis-pr-mergeados'.startsWith(s + '-')).toBe(true);
    });
});

describe('titleCoherenceWarning', () => {
    const base = { resumen: 'Sandbox Docker opt-in para run_command', content: '## Uso\nActivar con BK_RUN_COMMAND_SANDBOX' };

    it('accepts a title that shares a key term with the body (accent-insensitive)', () => {
        expect(titleCoherenceWarning({ ...base, title: 'Configuración del sandbox' })).toBeNull();
    });

    it('flags a title with no key term in common with the body', () => {
        const w = titleCoherenceWarning({ ...base, title: 'Política de vacaciones anuales' });
        expect(w).toContain('Política de vacaciones anuales');
    });

    it('does not flag titles that have no significant terms', () => {
        expect(titleCoherenceWarning({ ...base, title: 'Un día' })).toBeNull();
    });
});

describe('over-long titles in the curation pipeline', () => {
    let root: string;
    let vault: string;
    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), 'curator-title-'));
        vault = path.join(root, 'vault');
        await fs.mkdir(vault, { recursive: true });
    });
    afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

    const docNote = (title: string, over: Record<string, unknown> = {}) => ({
        type: 'decision', area: 'calidad', title, resumen: 'auditoría del framework', content: '## Cierre\nauditoría cerrada',
        tags: [], ...over,
    });

    it('DocumentationCurator no longer fails the file: the title is shortened by the LLM', async () => {
        const { provider, calls } = scripted([
            JSON.stringify({ notes: [docNote(LONG)] }),
            'Cierre de la auditoría del framework',
        ]);
        const r = await new DocumentationCurator({ provider, vaultPath: vault }).curateText('x', 'doc.md');
        expect(r.errors).toEqual([]);
        expect(r.notesWritten).toHaveLength(1);
        expect(await fs.readFile(r.notesWritten[0], 'utf-8')).toContain('title: "Cierre de la auditoría del framework"');
        expect(calls).toHaveLength(2);
    });

    it('keeps the file valid when shortening fails: word-boundary fallback', async () => {
        const { provider } = scripted([
            JSON.stringify({ notes: [docNote(LONG + ' ' + LONG)] }),
            new Error('rate limited'),
        ]);
        const r = await new DocumentationCurator({ provider, vaultPath: vault }).curateText('x', 'doc.md');
        expect(r.errors).toEqual([]);
        const md = await fs.readFile(r.notesWritten[0], 'utf-8');
        const title = /^title: "(.*)"$/m.exec(md)![1];
        expect(title.length).toBeLessThanOrEqual(MAX_TITLE);
        expect(title.endsWith('…')).toBe(true);
    });

    it('one over-long title does not discard the other notes of the same file', async () => {
        const { provider } = scripted([
            JSON.stringify({ notes: [docNote('Nota corta A'), docNote(LONG + ' ' + LONG), docNote('Nota corta C')] }),
            'Título acortado por el LLM',
        ]);
        const r = await new DocumentationCurator({ provider, vaultPath: vault }).curateText('x', 'doc.md');
        expect(r.errors).toEqual([]);
        expect(r.notesWritten).toHaveLength(3);
    });

    it('CodeAnalyzer applies the same guarantee', async () => {
        const file = path.join(root, 'a.ts');
        await fs.writeFile(file, 'export const a = 1;');
        const note = { ...docNote(LONG), type: 'componente', area: 'backend', language: 'typescript' };
        const { provider } = scripted([JSON.stringify({ notes: [note] }), 'Cierre de la auditoría']);
        const r = await new CodeAnalyzer({ provider, vaultPath: vault }).analyzeFile(file, 'a.ts');
        expect(r.errors).toEqual([]);
        expect(r.notesWritten).toHaveLength(1);
    });

    it('reports a warning (not an error) when the title shares nothing with the body', async () => {
        const { provider } = scripted([JSON.stringify({ notes: [docNote('Política de vacaciones anuales')] })]);
        const r = await new DocumentationCurator({ provider, vaultPath: vault }).curateText('x', 'doc.md');
        expect(r.errors).toEqual([]);
        expect(r.notesWritten).toHaveLength(1);
        expect(r.warnings).toHaveLength(1);
        expect(r.warnings![0]).toContain('Política de vacaciones anuales');
    });

    it('asks for short titles in the system prompt', async () => {
        const { provider, calls } = scripted([JSON.stringify({ notes: [docNote('Título')] })]);
        await new DocumentationCurator({ provider, vaultPath: vault }).curateText('x', 'doc.md');
        expect(calls[0].system).toContain('at most 80 characters (hard limit 120)');
    });
});
