import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodeIndexer } from '../indexer/indexer';
import type { GraphStore } from '../indexer/graph-store';

describe('CodeIndexer.indexDirectory — bounded concurrency', () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idx-'));
        for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(dir, `f${i}.ts`), `export const v${i} = ${i};\n`);
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    function indexerWithPeak(concurrency?: number) {
        const indexer = new CodeIndexer({} as GraphStore, dir, concurrency === undefined ? {} : { concurrency });
        let running = 0;
        const state = { peak: 0, calls: 0 };
        jest.spyOn(indexer, 'indexFile').mockImplementation(async () => {
            running++; state.calls++; state.peak = Math.max(state.peak, running);
            await new Promise(r => setTimeout(r, 5));
            running--;
            return { indexed: true, symbols: 2 };
        });
        return { indexer, state };
    }

    it('never has more than `concurrency` files in flight, and still indexes all of them', async () => {
        const { indexer, state } = indexerWithPeak(4);
        const result = await indexer.indexDirectory(dir);
        expect(result).toEqual({ files: 40, symbols: 80 });
        expect(state.calls).toBe(40);
        expect(state.peak).toBe(4);
    });

    it('defaults to 16', async () => {
        const { indexer, state } = indexerWithPeak();
        await indexer.indexDirectory(dir);
        expect(state.peak).toBe(16);
    });

    it('an empty directory is fine', async () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'idx-empty-'));
        try {
            const { indexer } = indexerWithPeak(4);
            expect(await indexer.indexDirectory(empty)).toEqual({ files: 0, symbols: 0 });
        } finally { fs.rmSync(empty, { recursive: true, force: true }); }
    });
});
