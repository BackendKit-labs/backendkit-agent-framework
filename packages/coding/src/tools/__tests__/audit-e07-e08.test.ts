/** Audit 2026-11-26: E-07 (search_files swept .env) and E-08 (framework protection off for a two-segment workingDir). */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, parse, sep } from 'path';
import { searchFilesTool } from '../search-files';
import { checkFrameworkProtection } from '../path-sandbox';

describe('search_files leaves .env out (E-07)', () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'bk-env-'));
        writeFileSync(join(dir, '.env'), 'API_KEY=sk-secret-value\n');
        writeFileSync(join(dir, '.env.local'), 'API_KEY=sk-other-secret\n');
        writeFileSync(join(dir, '.env.example'), 'API_KEY=\n');
        writeFileSync(join(dir, 'app.ts'), 'const key = process.env.API_KEY;\n');
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('a broad search does not return the lines of .env files, but does of templates and code', async () => {
        const out = String(await searchFilesTool.execute({ pattern: 'API_KEY', case_insensitive: false }, { workingDir: dir } as never));
        expect(out).not.toContain('sk-secret-value');
        expect(out).not.toContain('sk-other-secret');
        expect(out).toContain('.env.example');
        expect(out).toContain('app.ts');
    });
});

describe('framework protection is not turned off by a short workingDir (E-08)', () => {
    let root: string;
    beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'fw-short-')); });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    it('a workingDir of two segments above the framework repository still protects it', () => {
        const fw = join(root, 'framework');
        mkdirSync(join(fw, 'packages', 'core', 'src'), { recursive: true });
        writeFileSync(join(fw, 'packages', 'core', 'package.json'), JSON.stringify({ name: '@backendkit-labs/agent-core' }));
        const top = parse(root).root + root.slice(parse(root).root.length).split(sep)[0];   // e.g. C:\Users or /tmp
        expect(checkFrameworkProtection(join(fw, 'packages', 'core', 'src', 'index.ts'), top)).toMatch(/Framework protection/);
    });
});
