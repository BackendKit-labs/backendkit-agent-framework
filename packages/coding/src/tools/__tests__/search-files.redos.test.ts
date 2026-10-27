import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { searchFilesTool } from '../search-files';

describe('search_files — catastrophic patterns', () => {
    let dir: string;
    const ctx = () => ({ workingDir: dir }) as never;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'bk-search-'));
        mkdirSync(join(dir, 'src'));
        // (a+)+$ over this line backtracks for many seconds.
        writeFileSync(join(dir, 'src', 'evil.txt'), `${'a'.repeat(30)}b\n`);
        writeFileSync(join(dir, 'src', 'ok.txt'), 'hello world\nfoo bar\n');
        process.env.BK_SEARCH_FILES_TIMEOUT_MS = '400';
    });
    afterEach(() => {
        delete process.env.BK_SEARCH_FILES_TIMEOUT_MS;
        rmSync(dir, { recursive: true, force: true });
    });

    it('stops a catastrophic pattern over a directory and says why', async () => {
        const started = Date.now();
        const out = await searchFilesTool.execute({ pattern: '(a+)+$', case_insensitive: false }, ctx());
        expect(out).toMatch(/^Error: search stopped after .*too expensive/);
        expect(Date.now() - started).toBeLessThan(3000);
    });

    it('stops it over a single file too', async () => {
        const started = Date.now();
        const out = await searchFilesTool.execute({ pattern: '(a+)+$', path: 'src/evil.txt', case_insensitive: false }, ctx());
        expect(out).toMatch(/^Error: search stopped after/);
        expect(Date.now() - started).toBeLessThan(3000);
    });

    it('ordinary searches still work', async () => {
        const out = await searchFilesTool.execute({ pattern: 'hello', case_insensitive: false }, ctx());
        expect(out).toContain('ok.txt:1:hello world');
        const ci = await searchFilesTool.execute({ pattern: 'HELLO', case_insensitive: true }, ctx());
        expect(ci).toContain('ok.txt:1:hello world');
        expect(await searchFilesTool.execute({ pattern: 'zzz', case_insensitive: false }, ctx())).toBe('(no matches found)');
        expect(await searchFilesTool.execute({ pattern: '(', case_insensitive: false }, ctx())).toMatch(/^Error: Invalid regex/);
    });
});
