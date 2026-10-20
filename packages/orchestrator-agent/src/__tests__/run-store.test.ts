import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RunStore } from '../run-store.js';
import type { RunState } from '../run-store.js';

let dir: string;
let store: RunStore;
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
    store = new RunStore(path.join(dir, 'runs'));
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const state = (over: Partial<RunState> = {}): RunState => ({
    runId: store.newRunId(), task: 't', configPath: 'c.yaml', status: 'running',
    startedAt: new Date().toISOString(), updatedAt: '', completedSteps: [], ...over,
});

describe('RunStore', () => {
    it('newRunId is unique and well-formed', () => {
        const ids = new Set(Array.from({ length: 200 }, () => store.newRunId()));
        expect(ids.size).toBe(200);
        for (const id of ids) expect(id).toMatch(/^run-\d+-[a-z0-9]+$/);
    });

    it('save/load round-trips and stamps updatedAt', async () => {
        const s = state({ task: 'hello' });
        await store.save(s);
        const loaded = await store.load(s.runId);
        expect(loaded).toMatchObject({ runId: s.runId, task: 'hello' });
        expect(loaded!.updatedAt).not.toBe('');
    });

    it('load returns null for unknown or corrupt runs', async () => {
        expect(await store.load('run-0-nope')).toBeNull();
        fs.writeFileSync(path.join(dir, 'runs', 'run-1-bad.json'), '{broken');
        expect(await store.load('run-1-bad')).toBeNull();
    });

    it('load refuses ids that escape the store directory', async () => {
        const outside = path.join(dir, 'secret.json');
        fs.writeFileSync(outside, JSON.stringify({ runId: 'leaked', status: 'complete', task: 'x' }));
        expect(await store.load('../secret')).toBeNull();
        expect(await store.load('..\\secret')).toBeNull();
        expect(await store.load(outside.replace(/\.json$/, ''))).toBeNull();
    });

    it('list is newest-first and skips corrupt files', async () => {
        await store.save(state({ runId: 'run-1-old', startedAt: '2026-01-01T00:00:00Z' }));
        await store.save(state({ runId: 'run-2-new', startedAt: '2026-06-01T00:00:00Z' }));
        fs.writeFileSync(path.join(dir, 'runs', 'junk.json'), 'nope');
        expect((await store.list()).map(r => r.runId)).toEqual(['run-2-new', 'run-1-old']);
    });

    it('prune removes only old finished runs', async () => {
        const old = '2020-01-01T00:00:00Z';
        await store.save(state({ runId: 'run-1-done', status: 'complete', startedAt: old }));
        await store.save(state({ runId: 'run-2-failed', status: 'failed', startedAt: old }));
        await store.save(state({ runId: 'run-3-running', status: 'running', startedAt: old }));
        await store.save(state({ runId: 'run-4-gate', status: 'waiting_gate', startedAt: old }));
        await store.save(state({ runId: 'run-5-fresh', status: 'complete' }));

        expect(await store.prune(30)).toBe(2);
        const left = (await store.list()).map(r => r.runId).sort();
        expect(left).toEqual(['run-3-running', 'run-4-gate', 'run-5-fresh']);
    });
});
