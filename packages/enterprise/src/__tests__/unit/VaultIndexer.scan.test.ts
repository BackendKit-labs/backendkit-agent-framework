import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { VaultIndexer } from '../../rag/VaultIndexer';

// stat is wrapped (not replaced) so every test can observe or fail individual calls while the rest is real.
jest.mock('fs/promises', () => {
    const actual = jest.requireActual('fs/promises');
    return { ...actual, stat: jest.fn(actual.stat) };
});
const stat = fs.stat as unknown as jest.Mock;
const realStat = jest.requireActual('fs/promises').stat as typeof fs.stat;

describe('VaultIndexer.getChangedFiles — scanning a nested vault', () => {
    let dir: string;
    beforeEach(async () => {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-scan-'));
        stat.mockReset();
        stat.mockImplementation(realStat);
    });
    afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

    async function write(rel: string) {
        const p = path.join(dir, rel);
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, `# ${rel}\n`);
        return p;
    }

    it('finds every .md at any depth, skipping hidden entries and non-markdown files', async () => {
        const expected = [
            await write('a.md'),
            await write('x/b.md'),
            await write('x/y/c.md'),
            await write('x/y/z/d.md'),
            await write('other/e.md'),
        ];
        await write('.hidden/skip.md');
        await write('x/.dot.md');
        await write('x/notes.txt');

        const { toIndex } = await new VaultIndexer({ vaultPath: dir }).getChangedFiles(new Map());
        expect(toIndex.map(f => f.filePath).sort()).toEqual(expected.sort());
        for (const f of toIndex) expect(f.mtime).toBeGreaterThan(0);
    });

    it('honors excludeFiles by base name and drops files that vanish between listing and stat', async () => {
        const keep = await write('keep.md');
        const gone = await write('gone.md');
        await write('MEMORY.md');

        stat.mockImplementation(async (p: string, o?: never) => {
            if (String(p) === gone) throw new Error('ENOENT');
            return realStat(p, o);
        });

        const { toIndex } = await new VaultIndexer({ vaultPath: dir, excludeFiles: ['MEMORY.md'] }).getChangedFiles(new Map());
        expect(toIndex.map(f => f.filePath)).toEqual([keep]);
    });

    it('stats files in bounded parallel batches, not one at a time and not all at once', async () => {
        for (let i = 0; i < 100; i++) await write(`d${i % 5}/n${i}.md`);

        let running = 0;
        let peak = 0;
        stat.mockImplementation(async (p: string, o?: never) => {
            running++; peak = Math.max(peak, running);
            await new Promise(r => setTimeout(r, 2));
            running--;
            return realStat(p, o);
        });

        const { toIndex } = await new VaultIndexer({ vaultPath: dir }).getChangedFiles(new Map());
        expect(toIndex).toHaveLength(100);
        expect(peak).toBeGreaterThan(1);
        expect(peak).toBeLessThanOrEqual(32);
    });
});
