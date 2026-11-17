import { runFlow, FlowClaimError } from '../run';
import type { StepExecutor } from '../run';
import { MemoryRunJournal } from '../journal';
import type { RunJournal } from '../journal';
import { FlowDefinitionSchema } from '../types';
import { validateFlow, parseFlow } from '../loader';
import { FileRunJournal } from '../file-journal';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const flow = (steps: unknown[]) => FlowDefinitionSchema.parse({ flow: 'f', trigger: { type: 'manual' }, steps });
const say = (outputs: Record<string, string>, calls: string[] = []): StepExecutor => ({
    run: async s => { calls.push(s.id); return { content: outputs[s.id] ?? `out-${s.id}` }; },
});

describe('conditional steps (when)', () => {
    const decide = (when: unknown) => flow([
        { id: 'decision', agent: 'd', prompt: 'decide' },
        { id: 'execute', agent: 'e', prompt: 'do it', after: ['decision'], when, gate: { approval: 'human' } },
        { id: 'report', agent: 'r', prompt: 'report', after: ['execute'] },
    ]);

    it('skips a step whose condition does not hold: it does not run, no approval is asked, what waits for it is skipped, the flow does not fail', async () => {
        const calls: string[] = []; const approve = jest.fn(async () => true);
        const r = await runFlow(decide({ step: 'decision', contains: 'ENTER' }), { executor: say({ decision: 'DECISION: SKIP' }, calls), approve });
        expect(calls).toEqual(['decision']);
        expect(approve).not.toHaveBeenCalled();
        expect(r.steps.execute.status).toBe('skipped');
        expect(r.steps.report.status).toBe('skipped');
        expect(r.status).toBe('completed');
        const t = r.transitions.find(x => x.stepId === 'execute' && x.event === 'skipped');
        expect(t?.detail).toBe('condition not met: decision contains "ENTER"');
    });

    it('runs it when the condition holds', async () => {
        const calls: string[] = [];
        const r = await runFlow(decide({ step: 'decision', contains: 'ENTER' }), { executor: say({ decision: 'DECISION: ENTER size=10' }, calls) });
        expect(calls).toEqual(['decision', 'execute', 'report']);
        expect(r.status).toBe('completed');
    });

    it.each([
        [{ step: 'decision', equals: 'go' }, 'go', true],
        [{ step: 'decision', equals: 'go' }, ' go \n', true],
        [{ step: 'decision', equals: 'go' }, 'go now', false],
        [{ step: 'decision', matches: '^DECISION: (ENTER|ADD)' }, 'DECISION: ADD 5', true],
        [{ step: 'decision', matches: '^DECISION: (ENTER|ADD)' }, 'DECISION: SKIP', false],
        [{ step: 'decision', contains: 'SKIP', not: true }, 'DECISION: ENTER', true],
        [{ step: 'decision', contains: 'SKIP', not: true }, 'DECISION: SKIP', false],
    ])('%j on "%s" runs: %s', async (when, output, runs) => {
        const calls: string[] = [];
        await runFlow(decide(when), { executor: say({ decision: output }, calls) });
        expect(calls.includes('execute')).toBe(runs);
    });

    it('does not act on what it does not know: the step it looks at failed, so the condition cannot be evaluated', async () => {
        const calls: string[] = [];
        const executor: StepExecutor = { run: async s => { calls.push(s.id); if (s.id === 'decision') throw new Error('down'); return { content: 'x' }; } };
        const r = await runFlow(decide({ step: 'decision', contains: 'SKIP', not: true }), { executor, onStepFailure: 'continue' });
        expect(calls).toEqual(['decision']);
        expect(r.steps.execute.status).toBe('skipped');
        expect(r.status).toBe('failed'); // the failed decision is what fails the flow, not the skip
        expect(r.transitions.find(t => t.stepId === 'execute' && t.event === 'skipped')?.detail).toMatch(/not evaluable/);
    });

    it('a condition on a gated step with an approval store asks nobody when it is not met', async () => {
        const store = { put: jest.fn(), get: jest.fn(), resolve: jest.fn(), markExecuted: jest.fn(), list: jest.fn() };
        const r = await runFlow(decide({ step: 'decision', contains: 'ENTER' }), { executor: say({ decision: 'SKIP' }), approvals: { store: store as never } });
        expect(store.put).not.toHaveBeenCalled();
        expect(r.status).toBe('completed');
    });

    it('writes the skip to the journal', async () => {
        const journal = new MemoryRunJournal();
        await runFlow(decide({ step: 'decision', contains: 'ENTER' }), { executor: say({ decision: 'SKIP' }), journal, runId: 'r1' });
        const run = await journal.get('r1');
        expect(run?.steps.execute.status).toBe('skipped');
        expect(run?.status).toBe('done');
    });

    it('validateFlow rejects a condition on a step that is not in after, and a bad regular expression', () => {
        const bad = flow([
            { id: 'a', agent: 'x', prompt: 'p' },
            { id: 'b', agent: 'x', prompt: 'p' },
            { id: 'c', agent: 'x', prompt: 'p', after: ['a'], when: { step: 'b', contains: 'x' } },
            { id: 'd', agent: 'x', prompt: 'p', after: ['a'], when: { step: 'a', matches: '(' } },
        ]);
        const issues = validateFlow(bad);
        expect(issues.some(i => /step "c": when.step "b" must be one of its after/.test(i))).toBe(true);
        expect(issues.some(i => /step "d": when.matches is not a valid regular expression/.test(i))).toBe(true);
    });

    it('a condition needs exactly one operator', () => {
        expect(() => flow([{ id: 'a', agent: 'x', prompt: 'p' }, { id: 'b', agent: 'x', prompt: 'p', after: ['a'], when: { step: 'a' } }])).toThrow(/exactly one of contains, equals or matches/);
        expect(() => flow([{ id: 'a', agent: 'x', prompt: 'p' }, { id: 'b', agent: 'x', prompt: 'p', after: ['a'], when: { step: 'a', contains: 'x', equals: 'y' } }])).toThrow(/exactly one/);
    });

    it('is written in YAML', () => {
        const def = parseFlow(`
flow: f
trigger: { type: manual }
steps:
  - { id: a, agent: x, prompt: p }
  - id: b
    agent: x
    prompt: p
    after: [a]
    when: { step: a, contains: ENTER }
`);
        expect(def.steps[1].when).toEqual({ step: 'a', contains: 'ENTER', not: false });
    });
});

describe('the claim is renewed while the run lives', () => {
    const slow = (ms: number): StepExecutor => ({ run: async () => { await sleep(ms); return { content: 'ok' }; } });
    const one = flow([{ id: 'a', agent: 'x', prompt: 'p' }]);

    it('a run longer than the TTL is not taken over by another process', async () => {
        const journal = new MemoryRunJournal();
        const running = runFlow(one, { executor: slow(1500), journal, runId: 'long', owner: 'p1', claimTtlMs: 400, claimRenewMs: 100 });
        await sleep(1100); // nearly three TTLs in; the margins are wide because timers slip when the whole suite runs at once
        expect(await journal.claim('long', 'p2', 400)).toBeNull();
        await expect(runFlow(one, { executor: slow(1), journal, runId: 'long', owner: 'p2' })).rejects.toBeInstanceOf(FlowClaimError);
        expect((await running).status).toBe('completed');
        // finished: the claim is released and the next owner can take it
        expect(await journal.claim('long', 'p2', 400)).not.toBeNull();
    });

    it('by default it renews at a third of the TTL', async () => {
        const journal = new MemoryRunJournal();
        const running = runFlow(one, { executor: slow(1500), journal, runId: 'dflt', owner: 'p1', claimTtlMs: 450 });
        await sleep(1100); // more than two TTLs: it was renewed at 150 ms, 300 ms...
        expect(await journal.claim('dflt', 'p2', 450)).toBeNull();
        await running;
    });

    it('with renewal off the claim expires, as it does for a process that died', async () => {
        const journal = new MemoryRunJournal();
        const hung = runFlow(one, { executor: { run: () => new Promise(() => undefined) }, journal, runId: 'dead', owner: 'p1', claimTtlMs: 40, claimRenewMs: 0 });
        hung.catch(() => undefined);
        await sleep(100);
        expect(await journal.claim('dead', 'p2', 60)).not.toBeNull();
    });

    it('if the claim is found taken, the run stops, nothing is written over the new owner, and runFlow throws', async () => {
        const inner = new MemoryRunJournal();
        let claims = 0;
        const journal: RunJournal = {
            begin: r => inner.begin(r), step: (a, b, c) => inner.step(a, b, c), update: (a, b) => inner.update(a, b),
            get: a => inner.get(a), list: f => inner.list(f),
            claim: (a, b, c) => (++claims > 1 ? Promise.resolve(null) : inner.claim(a, b, c)), // the first call takes it, a renewal finds it gone
        };
        let aborted = false;
        const executor: StepExecutor = { run: async (_s, i) => { i.signal.addEventListener('abort', () => { aborted = true; }); await sleep(200); return { content: 'late' }; } };
        await expect(runFlow(one, { executor, journal, runId: 'lost', owner: 'p1', claimTtlMs: 60, claimRenewMs: 20 })).rejects.toBeInstanceOf(FlowClaimError);
        expect(aborted).toBe(true);
        expect((await inner.get('lost'))?.status).toBe('running'); // not "cancelled": the new owner decides
    });

    it('a journal that cannot be reached for a renewal does not stop the run', async () => {
        const inner = new MemoryRunJournal();
        let claims = 0;
        const journal: RunJournal = {
            begin: r => inner.begin(r), step: (a, b, c) => inner.step(a, b, c), update: (a, b) => inner.update(a, b),
            get: a => inner.get(a), list: f => inner.list(f),
            claim: (a, b, c) => (++claims === 2 ? Promise.reject(new Error('redis down')) : inner.claim(a, b, c)),
        };
        const r = await runFlow(one, { executor: slow(120), journal, runId: 'blip', owner: 'p1', claimTtlMs: 90, claimRenewMs: 20 });
        expect(r.status).toBe('completed');
    });

    it('works with the file journal: each renewal replaces the claim and the run still releases it', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'renew-'));
        try {
            const journal = new FileRunJournal(dir);
            const running = runFlow(one, { executor: slow(3500), journal, runId: 'file-run', owner: 'p1', claimTtlMs: 2000, claimRenewMs: 400 });
            await sleep(2800); // past the TTL; file writes are slow when the whole suite runs at once, so the margins are wide
            expect(await journal.claim('file-run', 'p2', 2000)).toBeNull();
            expect((await running).status).toBe('completed');
            expect(await journal.claim('file-run', 'p2', 2000)).not.toBeNull();
        } finally { await fs.rm(dir, { recursive: true, force: true }); }
    });

    it('the timer does not outlive the run', async () => {
        const journal = new MemoryRunJournal();
        const spy = jest.spyOn(global, 'clearInterval');
        await runFlow(one, { executor: slow(1), journal, runId: 'tidy', claimTtlMs: 60, claimRenewMs: 20 });
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });
});

describe('the result carries the cost', () => {
    const two = flow([{ id: 'a', agent: 'x', prompt: 'p' }, { id: 'b', agent: 'x', prompt: 'p', after: ['a'] }]);

    it('sums what the steps reported, in the result and in the journal', async () => {
        const journal = new MemoryRunJournal();
        const executor: StepExecutor = { run: async s => ({ content: 'ok', costUsd: s.id === 'a' ? 0.01 : 0.025 }) };
        const r = await runFlow(two, { executor, journal, runId: 'c1' });
        expect(r.costUsd).toBeCloseTo(0.035);
        expect((await journal.get('c1'))?.costUsd).toBeCloseTo(0.035);
        // a finished run answered from the journal has it too
        expect((await runFlow(two, { executor, journal, runId: 'c1' })).costUsd).toBeCloseTo(0.035);
    });

    it('is absent when no step reported a cost', async () => {
        const r = await runFlow(two, { executor: say({}) });
        expect('costUsd' in r).toBe(false);
    });
});
