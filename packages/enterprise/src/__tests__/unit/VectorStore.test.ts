import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { VectorStore } from '../../rag/VectorStore';
import type { VectorChunk } from '../../rag/VectorStore';

function makeChunk(id: string, filePath: string, embedding: number[], mtime = 1000): VectorChunk {
    return {
        id,
        filePath,
        title: `Title ${id}`,
        section: '',
        text: `Text for chunk ${id}`,
        embedding,
        metadata: { tags: [], description: '', mtime },
    };
}

describe('VectorStore — unit', () => {
    let tmpDir: string;
    let storePath: string;

    beforeAll(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-rag-test-'));
        storePath = path.join(tmpDir, 'store.json');
    });

    afterAll(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    // ── in-memory operations ──────────────────────────────────────────────────

    test('addChunks aumenta el tamaño', () => {
        const store = new VectorStore(storePath, 'test-model');
        expect(store.size).toBe(0);
        store.addChunks([makeChunk('a', '/doc1.md', [1, 0, 0])]);
        expect(store.size).toBe(1);
        store.addChunks([makeChunk('b', '/doc2.md', [0, 1, 0])]);
        expect(store.size).toBe(2);
    });

    test('removeFile elimina todos los chunks del archivo', () => {
        const store = new VectorStore(storePath, 'test-model');
        store.addChunks([
            makeChunk('c1', '/multi.md', [1, 0, 0]),
            makeChunk('c2', '/multi.md', [0, 1, 0]),
            makeChunk('c3', '/other.md', [0, 0, 1]),
        ]);
        store.removeFile('/multi.md');
        expect(store.size).toBe(1);
    });

    test('getKnownMtimes devuelve un entry por filePath', () => {
        const store = new VectorStore(storePath, 'test-model');
        store.addChunks([
            makeChunk('m1', '/a.md', [1, 0], 1000),
            makeChunk('m2', '/a.md', [0, 1], 1000), // mismo archivo, mismo mtime
            makeChunk('m3', '/b.md', [1, 1], 2000),
        ]);
        const mtimes = store.getKnownMtimes();
        expect(mtimes.size).toBe(2);
        expect(mtimes.get('/a.md')).toBe(1000);
        expect(mtimes.get('/b.md')).toBe(2000);
    });

    test('search devuelve resultados ordenados por similitud descendente', () => {
        const store = new VectorStore(storePath, 'test-model');
        // Vector base [1, 0, 0]: chunks más cercanos primero
        store.addChunks([
            makeChunk('s1', '/a.md', [1, 0, 0]),   // idéntico → score 1.0
            makeChunk('s2', '/b.md', [0, 1, 0]),   // ortogonal → score 0.0
            makeChunk('s3', '/c.md', [0.9, 0.1, 0]), // parecido → score ~0.99
        ]);

        const query = [1, 0, 0];
        const results = store.search(query, 3);

        expect(results[0].chunk.id).toBe('s1');
        expect(results[1].chunk.id).toBe('s3');
        expect(results[2].chunk.id).toBe('s2');
        expect(results[0].score).toBeCloseTo(1.0, 4);
        expect(results[2].score).toBeCloseTo(0.0, 4);
    });

    test('search respeta topK', () => {
        const store = new VectorStore(storePath, 'test-model');
        store.addChunks([
            makeChunk('t1', '/a.md', [1, 0]),
            makeChunk('t2', '/b.md', [0, 1]),
            makeChunk('t3', '/c.md', [0.5, 0.5]),
        ]);
        const results = store.search([1, 0], 2);
        expect(results).toHaveLength(2);
    });

    // ── persistencia ─────────────────────────────────────────────────────────

    test('save/load round-trip preserva chunks', async () => {
        const sp = path.join(tmpDir, 'round-trip.json');
        const store = new VectorStore(sp, 'nomic-embed-text');
        store.addChunks([makeChunk('rt1', '/x.md', [1, 0, 0])]);
        await store.save();

        const loaded = new VectorStore(sp, 'nomic-embed-text');
        await loaded.load();
        expect(loaded.size).toBe(1);
        const results = loaded.search([1, 0, 0], 1);
        expect(results[0].chunk.id).toBe('rt1');
    });

    test('load con modelo diferente resetea el índice', async () => {
        const sp = path.join(tmpDir, 'mismatch.json');
        const storeA = new VectorStore(sp, 'model-a');
        storeA.addChunks([makeChunk('mm1', '/y.md', [1, 0])]);
        await storeA.save();

        const storeB = new VectorStore(sp, 'model-b');
        await storeB.load();
        expect(storeB.size).toBe(0);
    });

    test('save no escribe a disco si no hay cambios', async () => {
        const sp = path.join(tmpDir, 'no-write.json');
        const store = new VectorStore(sp, 'test-model');
        await store.save(); // dirty=false, no debe crear el archivo
        await expect(fs.access(sp)).rejects.toThrow();
    });
});
