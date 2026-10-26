import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildEpisodicFn } from '../episodic.js';
import type { IRunStore, RunState, StepResult } from '../run-store.js';

const index = jest.fn(async () => undefined);
const search = jest.fn(async () => 'hit');
jest.mock('../lance-rag.js', () => ({
    LanceRAGProvider: class {
        index = index;
        search = search;
    },
}));
// eslint-disable-next-line import/first
import { buildRAG, clearRAGCache } from '../rag.js';

const step = (agentId: string, task: string, output: string, success = true): StepResult =>
    ({ stepId: 's', agentId, task, output, success, durationMs: 1 });
const run = (status: RunState['status'], steps: StepResult[]): RunState => ({ runId: 'r', status, completedSteps: steps } as unknown as RunState);
const LONG = 'x'.repeat(80);

function storeWith(runs: RunState[] | Error) {
    const list = jest.fn(async () => { if (runs instanceof Error) throw runs; return runs; });
    return { store: { list } as unknown as IRunStore, list };
}

describe('buildEpisodicFn — the run store is read once, not once per subtask', () => {
    const runs = [run('complete', [step('dev', 'implement parser module', `parser ${LONG}`), step('qa', 'review parser', `ok ${LONG}`)]), run('failed', [step('dev', 'implement parser', LONG)])];

    it('ten lookups cost one store scan, and the result is unchanged', async () => {
        const { store, list } = storeWith(runs);
        const fn = buildEpisodicFn(store);
        const outs = await Promise.all(Array.from({ length: 10 }, () => fn('dev', 'implement the parser module')));
        expect(list).toHaveBeenCalledTimes(1);
        for (const o of outs) {
            expect(o).toContain('Examples from past successful runs by this agent');
            expect(o).toContain('implement parser module');
        }
    });

    it('still filters by agent, success and output length', async () => {
        const { store } = storeWith(runs);
        const fn = buildEpisodicFn(store);
        expect(await fn('qa', 'deploy database cluster')).toBe(''); // qa's step does not match the task
        expect(await fn('qa', 'review parser changes')).toContain('review parser'); // dev's steps are never shown to qa
        expect(await fn('qa', 'review parser changes')).not.toContain('implement parser module');
        expect(await fn('nobody', 'implement the parser module')).toBe('');
        expect(await fn('dev', 'zz')).toBe(''); // no query token longer than 3 chars
    });

    it('reads again after the ttl', async () => {
        const { store, list } = storeWith(runs);
        let t = 0;
        const fn = buildEpisodicFn(store, { ttlMs: 1000, now: () => t });
        await fn('dev', 'implement parser');
        t = 999; await fn('dev', 'implement parser');
        expect(list).toHaveBeenCalledTimes(1);
        t = 1001; await fn('dev', 'implement parser');
        expect(list).toHaveBeenCalledTimes(2);
    });

    it('a store failure yields no examples and is not cached', async () => {
        let fail = true;
        const list = jest.fn(async () => { if (fail) throw new Error('redis down'); return runs; });
        const fn = buildEpisodicFn({ list } as unknown as IRunStore);
        expect(await fn('dev', 'implement parser')).toBe('');
        fail = false;
        expect(await fn('dev', 'implement parser')).toContain('Examples');
        expect(list).toHaveBeenCalledTimes(2);
    });
});

describe('buildRAG — the vault index is reused', () => {
    let dir: string;
    const config = (vaultPath: string) => ({ orchestrator: { vault: { path: vaultPath, embedder: 'simple' } } }) as never;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-cache-')); clearRAGCache(); index.mockClear(); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('starting two runs indexes the vault once', async () => {
        const a = await buildRAG(config('/vault'), dir);
        const b = await buildRAG(config('/vault'), dir);
        expect(index).toHaveBeenCalledTimes(1);
        expect(await a!.search('q')).toBe('hit');
        expect(b).toBe(a);
    });

    it('concurrent builds share one index pass', async () => {
        await Promise.all([buildRAG(config('/vault'), dir), buildRAG(config('/vault'), dir), buildRAG(config('/vault'), dir)]);
        expect(index).toHaveBeenCalledTimes(1);
    });

    it('a different vault is a different index; no vault means no RAG', async () => {
        await buildRAG(config('/vault-a'), dir);
        await buildRAG(config('/vault-b'), dir);
        expect(index).toHaveBeenCalledTimes(2);
        expect(await buildRAG({ orchestrator: {} } as never, dir)).toBeNull();
    });

    it('a failed build is not remembered', async () => {
        index.mockRejectedValueOnce(new Error('ollama down'));
        await expect(buildRAG(config('/vault'), dir)).rejects.toThrow('ollama down');
        await expect(buildRAG(config('/vault'), dir)).resolves.not.toBeNull();
        expect(index).toHaveBeenCalledTimes(2);
    });
});
