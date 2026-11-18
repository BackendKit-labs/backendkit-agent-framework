import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { runFlow, FlowClaimError } from '../run';
import type { StepExecutor } from '../run';
import { MemoryRunJournal } from '../journal';
import type { RunJournal } from '../journal';
import { NdjsonRunJournal } from '../ndjson-journal';
import { FlowDefinitionSchema } from '../types';

const def = (ids: string[]) => FlowDefinitionSchema.parse({
    flow: 'f', trigger: { type: 'manual' },
    steps: ids.map((id, i) => ({ id, agent: `agent-${id}`, prompt: `Do ${id}`, after: i > 0 ? [ids[i - 1]] : [] })),
});

function counting(fail: Set<string> = new Set()) {
    const calls: Array<{ id: string; key: string; context?: string }> = [];
    const executor: StepExecutor = {
        run: async (s, i) => {
            calls.push({ id: s.id, key: i.idempotencyKey, context: i.context });
            if (fail.has(s.id)) throw new Error(`${s.id} down`);
            return { content: `out-${s.id}` };
        },
    };
    return { executor, calls };
}

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

/** The last is whether the claim expires by TTL (the ndjson journal frees it when its holder is gone, and ignores the TTL). */
const implementations: Array<[string, () => RunJournal, boolean]> = [
    ['MemoryRunJournal', () => new MemoryRunJournal(), true],
    ['NdjsonRunJournal', () => new NdjsonRunJournal(dir), false],
];

describe.each(implementations)('%s', (_name, make, expiresByTtl) => {
    it('records begin, step states, outputs and the final status', async () => {
        const journal = make();
        const { executor } = counting();
        await runFlow(def(['a', 'b']), { executor, journal, runId: 'r1', payload: { secret: 'x' }, redact: s => s.replace('x', '***') });
        const run = (await journal.get('r1'))!;
        expect(run.status).toBe('done');
        expect(run.steps.a).toMatchObject({ status: 'done', output: 'out-a', attempt: 1 });
        expect(run.steps.b.status).toBe('done');
        expect(run.inputPreview).toBe('{"secret":"***"}');
        expect(run.finishedAt).toBeDefined();
        expect(run.transitions.map(t => t.event)).toEqual(['started', 'completed', 'started', 'completed']);
        expect((await journal.list({ status: ['done'] })).map(r => r.runId)).toEqual(['r1']);
        expect(await journal.list({ status: ['failed'] })).toEqual([]);
    });

    it('resume after a crash between steps: the done step is not repeated and feeds the next', async () => {
        const journal = make();
        // First process: a done, then it dies in b (b stays "running").
        await journal.begin({ runId: 'r2', flow: 'f', inputPreview: '' });
        await journal.step('r2', 'a', { status: 'done', output: 'out-a', attempt: 1 });
        await journal.step('r2', 'b', { status: 'running', attempt: 1 });

        const { executor, calls } = counting();
        const r = await runFlow(def(['a', 'b', 'c']), { executor, journal, runId: 'r2' });
        expect(r.status).toBe('completed');
        expect(calls.map(c => c.id)).toEqual(['b', 'c']);
        expect(calls[0].key).toBe('r2:b:2'); // the retry carries attempt 2
        expect(calls[0].context).toContain('out-a');
        expect((await journal.get('r2'))!.steps.b.attempt).toBe(2);
    });

    it('onInterrupted "fail" does not retry a step that died running', async () => {
        const journal = make();
        await journal.begin({ runId: 'r3', flow: 'f', inputPreview: '' });
        await journal.step('r3', 'a', { status: 'running', attempt: 1 });
        const { executor, calls } = counting();
        const r = await runFlow(def(['a', 'b']), { executor, journal, runId: 'r3', onInterrupted: 'fail' });
        expect(calls).toEqual([]);
        expect(r.status).toBe('failed');
        expect(r.steps.b.status).toBe('skipped');
        expect((await journal.get('r3'))!.steps.a.status).toBe('interrupted');
    });

    it('resuming a failed run retries the failed step only', async () => {
        const journal = make();
        const first = counting(new Set(['b']));
        const r1 = await runFlow(def(['a', 'b']), { executor: first.executor, journal, runId: 'r4' });
        expect(r1.status).toBe('failed');
        expect((await journal.get('r4'))!.status).toBe('failed');
        const second = counting();
        const r2 = await runFlow(def(['a', 'b']), { executor: second.executor, journal, runId: 'r4' });
        expect(r2.status).toBe('completed');
        expect(second.calls.map(c => c.id)).toEqual(['b']);
    });

    it('resuming a finished run runs nothing and returns it', async () => {
        const journal = make();
        const { executor } = counting();
        await runFlow(def(['a']), { executor, journal, runId: 'r5' });
        const again = counting();
        const r = await runFlow(def(['a']), { executor: again.executor, journal, runId: 'r5' });
        expect(again.calls).toEqual([]);
        expect(r.status).toBe('completed');
        expect(r.steps.a.content).toBe('out-a');
    });

    it('a journal that cannot write stops the step from running (fails closed)', async () => {
        const journal = make();
        const broken: RunJournal = Object.create(journal);
        broken.step = async () => { throw new Error('disk full'); };
        const { executor, calls } = counting();
        const r = await runFlow(def(['a']), { executor, journal: broken, runId: 'r6' });
        expect(calls).toEqual([]);
        expect(r.status).toBe('failed');
        expect(r.steps.a.error).toBe('disk full');
    });

    it('two runners cannot hold the same run: the second gets FlowClaimError', async () => {
        const journal = make();
        let release!: () => void;
        const hold = new Promise<void>(r => { release = r; });
        const slow: StepExecutor = { run: async () => { await hold; return { content: 'x' }; } };
        const first = runFlow(def(['a']), { executor: slow, journal, runId: 'r7', owner: 'p1' });
        await new Promise(r => setTimeout(r, 30));
        await expect(runFlow(def(['a']), { executor: counting().executor, journal, runId: 'r7', owner: 'p2' }))
            .rejects.toBeInstanceOf(FlowClaimError);
        release();
        expect((await first).status).toBe('completed');
    });

    it('claim: exclusive while valid, free after release or expiry', async () => {
        const journal = make();
        await journal.begin({ runId: 'c1', flow: 'f', inputPreview: '' });
        const a = await journal.claim('c1', 'a', 60_000);
        expect(a).not.toBeNull();
        expect(await journal.claim('c1', 'b', 60_000)).toBeNull();
        await a!();
        const b = await journal.claim('c1', 'b', 20);
        expect(b).not.toBeNull();
        if (!expiresByTtl) return; // a live holder is respected however long it takes
        await new Promise(r => setTimeout(r, 40));
        expect(await journal.claim('c1', 'c', 60_000)).not.toBeNull(); // b's expired
    });

    it('a run of another flow cannot be resumed with this definition', async () => {
        const journal = make();
        await journal.begin({ runId: 'x1', flow: 'other', inputPreview: '' });
        await expect(runFlow(def(['a']), { executor: counting().executor, journal, runId: 'x1' })).rejects.toThrow(/belongs to flow/);
    });
});
