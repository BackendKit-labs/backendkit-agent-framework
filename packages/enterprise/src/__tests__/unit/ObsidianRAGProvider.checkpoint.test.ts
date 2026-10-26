import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ObsidianRAGProvider } from '../../rag/ObsidianRAGProvider';
import { VectorStore } from '../../rag/VectorStore';

const FILES = 35; // 4 batches of 10 (BATCH_SIZE)

const embedder = {
    model: 'fake',
    embed: async (texts: string[]) => texts.map(() => [1, 0, 0]),
    embedOne: async () => [1, 0, 0],
};

describe('ObsidianRAGProvider.index — checkpoints are time based, not per batch', () => {
    let dir: string;
    beforeEach(async () => {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-'));
        const vault = path.join(dir, 'vault');
        await fs.mkdir(vault);
        for (let i = 0; i < FILES; i++) {
            await fs.writeFile(path.join(vault, `n${i}.md`), `---\ntitle: Nota ${i}\n---\n\n## Tema\n\nContenido de la nota ${i}.\n`);
        }
    });
    afterEach(async () => { jest.restoreAllMocks(); await fs.rm(dir, { recursive: true, force: true }); });

    const provider = (extra: { checkpointIntervalMs?: number } = {}) => new ObsidianRAGProvider({
        vaultPath: path.join(dir, 'vault'),
        indexPath: path.join(dir, 'idx.json'),
        embedder,
        batchPacingMs: 0, stagePacingMs: 0,
        ...extra,
    });

    it('with the default interval a quick reindex writes the index once, at the end', async () => {
        const save = jest.spyOn(VectorStore.prototype, 'save');
        const result = await provider().index();
        expect(result.indexed).toBeGreaterThan(0);
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('checkpointIntervalMs: 0 keeps the old behavior (a save per batch plus the final one)', async () => {
        const save = jest.spyOn(VectorStore.prototype, 'save');
        await provider({ checkpointIntervalMs: 0 }).index();
        expect(save).toHaveBeenCalledTimes(Math.ceil(FILES / 10) + 1);
    });

    it('still checkpoints mid-index once the interval has passed, so a crash can resume', async () => {
        let now = 1_000_000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
        const save = jest.spyOn(VectorStore.prototype, 'save');
        const slowEmbedder = { ...embedder, embed: async (t: string[]) => { now += 20_000; return embedder.embed(t); } };
        await new ObsidianRAGProvider({
            vaultPath: path.join(dir, 'vault'), indexPath: path.join(dir, 'idx2.json'), embedder: slowEmbedder,
            batchPacingMs: 0, stagePacingMs: 0, checkpointIntervalMs: 30_000,
        }).index();
        // each batch "takes" 20 s: saves after batches 2 and 4, plus the final one
        expect(save.mock.calls.length).toBeGreaterThan(1);
        expect(save.mock.calls.length).toBeLessThan(Math.ceil(FILES / 10) + 1);
    });

    it('the index on disk holds every file after the final save', async () => {
        await provider().index();
        const saved = JSON.parse(await fs.readFile(path.join(dir, 'idx.json'), 'utf-8'));
        const text = JSON.stringify(saved);
        expect(text).toContain('Nota 0');
        expect(text).toContain(`Nota ${FILES - 1}`);
    });
});
