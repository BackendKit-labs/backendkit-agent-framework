import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { runFlow } from '../run';
import type { StepExecutor } from '../run';
import { FileRunJournal } from '../file-journal';
import { FlowDefinitionSchema } from '../types';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'contention-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

const newRun = (runId: string) => ({ runId, flow: 'f', owner: 'o', steps: [] } as never);

describe('FileRunJournal under contention', () => {
    it('a wide fan-out in one process: 120 steps writing to the same run at once lose nothing', async () => {
        const journal = new FileRunJournal(dir);
        await journal.begin(newRun('wide'));
        await Promise.all(Array.from({ length: 120 }, (_, i) => journal.step('wide', `s${i}`, { status: 'done', attempt: 1, output: `o${i}` })));
        const run = await journal.get('wide');
        expect(Object.keys(run!.steps)).toHaveLength(120);
        expect(run!.steps.s119.output).toBe('o119');
    });

    it('a flow with 60 parallel steps finishes with a file journal (it used to fail with "too much contention")', async () => {
        const ids = Array.from({ length: 60 }, (_, i) => `p${i}`);
        const def = FlowDefinitionSchema.parse({
            flow: 'wide-flow', trigger: { type: 'manual' },
            steps: [...ids.map(id => ({ id, agent: 'a', prompt: 'x' })), { id: 'end', agent: 'a', prompt: 'y', after: ids }],
        });
        const executor: StepExecutor = { run: async s => ({ content: `out-${s.id}` }) };
        const r = await runFlow(def, { executor, journal: new FileRunJournal(dir), runId: 'wide-flow-1', maxConcurrency: 60 });
        expect(r.status).toBe('completed');
        expect(Object.values(r.steps).every(s => s.status === 'completed')).toBe(true);
    });

    it('two journals on the same directory (as two processes) writing to one run at once lose nothing either', async () => {
        const a = new FileRunJournal(dir); const b = new FileRunJournal(dir);
        await a.begin(newRun('two'));
        await Promise.all(Array.from({ length: 80 }, (_, i) => (i % 2 ? a : b).step('two', `s${i}`, { status: 'done', attempt: 1 })));
        expect(Object.keys((await a.get('two'))!.steps)).toHaveLength(80);
    });

    it('an append to a run that does not exist is still refused, and does not block the ones after it', async () => {
        const journal = new FileRunJournal(dir);
        await expect(journal.step('ghost', 's', { status: 'done' })).rejects.toThrow('does not exist');
        await journal.begin(newRun('real'));
        await journal.step('real', 's', { status: 'done', attempt: 1 });
        expect((await journal.get('real'))!.steps.s.status).toBe('done');
    });

    it('a failed append does not stop the appends queued behind it', async () => {
        const journal = new FileRunJournal(dir);
        await journal.begin(newRun('q'));
        const results = await Promise.allSettled([
            journal.step('q', 'a', { status: 'done', attempt: 1 }),
            journal.step('q', '../bad', { status: 'done' }), // an odd step key is just a key
            journal.step('q', 'b', { status: 'done', attempt: 1 }),
        ]);
        expect(results.map(r => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
        expect(Object.keys((await journal.get('q'))!.steps).sort()).toEqual(['../bad', 'a', 'b']);
    });
});
