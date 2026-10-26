import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EpisodicMemory } from '../EpisodicMemory';
import { JsonFileStore } from '../stores/JsonFileStore';
import { InMemoryStore } from '../stores/InMemoryStore';
import { MetricsCollector } from '../../observability/MetricsCollector';

describe('EpisodicMemory.recall — one write per recall', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epi-')); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('touches every matched episode in a single batched write and persists the counts', () => {
        const file = path.join(dir, 'ep.json');
        const mem = new EpisodicMemory({ provider: 'json', path: file });
        for (let i = 0; i < 5; i++) mem.remember(`deploy failure number ${i}`, ['ops']);

        const many = jest.spyOn(JsonFileStore.prototype, 'upsertMany');
        const single = jest.spyOn(JsonFileStore.prototype, 'upsert');
        const hits = mem.recall('deploy failure', 5);
        const calls = { many: many.mock.calls.length, single: single.mock.calls.length };
        many.mockRestore(); single.mockRestore();

        expect(hits).toHaveLength(5);
        expect(calls).toEqual({ many: 1, single: 0 }); // 5 matches used to mean 5 separate upserts

        const reopened = new JsonFileStore(file).getAll() as unknown as Array<{ recallCount: number }>;
        expect(reopened.map(r => r.recallCount)).toEqual([1, 1, 1, 1, 1]);
    });

    it('also works with a backend that has no upsertMany', () => {
        const backend = new InMemoryStore();
        (backend as { upsertMany?: unknown }).upsertMany = undefined;
        const mem = new EpisodicMemory({});
        (mem as unknown as { backend: InMemoryStore }).backend = backend;
        mem.remember('alpha beta', []);
        mem.recall('alpha');
        expect((backend.getAll()[0] as unknown as { recallCount: number }).recallCount).toBe(1);
    });
});

describe('EpisodicMemory summarization replaces what it summarized', () => {
    it('does not just add a summary on top of the episodes it covers', async () => {
        const summarizeFn = jest.fn(async () => 'SUMMARY');
        const mem = new EpisodicMemory({}, { summarizeAfter: 3, summarizeFn });
        mem.remember('one'); mem.remember('two'); mem.remember('three'); // triggers the summary
        await new Promise(r => setImmediate(r));
        await new Promise(r => setImmediate(r));

        expect(summarizeFn).toHaveBeenCalledTimes(1);
        const kept = mem.recallRecent(10).map(e => e.content);
        expect(kept).toEqual(['SUMMARY']);
        expect(mem.count()).toBe(1);
    });
});

describe('MetricsCollector — bounded run durations', () => {
    it('is exact below the reservoir size', () => {
        const m = new MetricsCollector();
        for (let i = 1; i <= 100; i++) m.recordRun(i, i % 10 === 0);
        const { runs } = m.getSnapshot();
        expect(runs.total).toBe(100);
        expect(runs.errors).toBe(10);
        expect(runs.totalDurationMs).toBe(5050);
        expect(runs.p50Ms).toBe(50);
        expect(runs.p95Ms).toBe(95);
        expect(runs.p99Ms).toBe(99);
    });

    it('keeps exact totals but bounded memory over many runs, with sane percentiles', () => {
        const m = new MetricsCollector();
        const N = 50_000;
        for (let i = 1; i <= N; i++) m.recordRun(i, false);
        const { runs } = m.getSnapshot();
        expect(runs.total).toBe(N);
        expect(runs.totalDurationMs).toBe((N * (N + 1)) / 2);
        expect((m as unknown as { durations: number[] }).durations.length).toBeLessThanOrEqual(1_024);
        // uniform 1..N: the median estimate should land near N/2
        expect(runs.p50Ms!).toBeGreaterThan(N * 0.4);
        expect(runs.p50Ms!).toBeLessThan(N * 0.6);
        expect(runs.p99Ms!).toBeGreaterThan(N * 0.9);
    });

    it('an empty collector reports null percentiles', () => {
        expect(new MetricsCollector().getSnapshot().runs.p50Ms).toBeNull();
    });
});
