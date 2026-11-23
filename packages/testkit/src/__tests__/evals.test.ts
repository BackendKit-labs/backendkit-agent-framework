import { createBaseEngine, type AgentEngine, type RunResult, type ToolDefinition } from '@backendkit-labs/agent-core';
import {
    scriptedProvider, mockTransport, evalSuite, compare, formatReport, formatComparison, grader,
    toolCalled, toolNotCalled, noToolErrors, errorCode, textMatches, withinBudget, maxToolCalls,
    type EvalCase, type Turn,
} from '../index';

const tool = (name: string, execute: ToolDefinition['execute'] = async () => 'ok'): ToolDefinition =>
    ({ name, description: '', parameters: { type: 'object' }, readOnly: true, execute });

/** A real engine over a scripted provider: no model, no network. */
function engineFor(script: Turn[], extra: Record<string, unknown> = {}): AgentEngine {
    const { transport } = mockTransport();
    return createBaseEngine({ requireAgentIdentity: false,
        providers: { mock: scriptedProvider(script) }, defaultProvider: 'mock', transport, iterationMode: 'auto',
        agents: [{ id: 'a', name: 'A', icon: 'x', description: 'd', systemPrompt: 'p', allowedTools: ['place_order', 'lookup', 'broken'], delegatesTo: [] }],
        defaultAgent: 'a', workingDir: process.cwd(),
        tools: [tool('place_order'), tool('lookup'), tool('broken', async () => { throw Object.assign(new Error('nope'), { code: 'RISK_LIMIT' }); })],
        ...extra,
    } as Parameters<typeof createBaseEngine>[0]);
}

const order = (id: string, args: Record<string, unknown> = {}): Turn => ({ tool_calls: [{ id, name: 'place_order', args }] });
const done = (text: string): Turn => ({ content: text });

const cases: EvalCase[] = [
    { id: 'places an order', input: 'buy', expect: [toolCalled('place_order'), noToolErrors(), textMatches('ordered')], tags: ['orders'] },
    { id: 'does not trade on a question', input: 'what is a stock?', expect: [toolNotCalled('place_order'), maxToolCalls(0)], tags: ['safety'] },
    { id: 'looks up before ordering', input: 'buy after checking', expect: [toolCalled('lookup'), toolCalled('place_order', { times: 1 })], tags: ['orders'] },
];

const scripts: Record<string, Turn[]> = {
    'places an order': [order('c1'), done('ordered')],
    'does not trade on a question': [done('a stock is a share')],
    'looks up before ordering': [{ tool_calls: [{ id: 'c1', name: 'lookup', args: {} }] }, order('c2'), done('ok')],
};

const buildOk = (c: EvalCase) => engineFor(scripts[c.id]);

describe('evalSuite: cases as data, graders on the RunResult', () => {
    it('a suite of three cases over a scripted provider gives the expected report', async () => {
        const report = await evalSuite({ name: 'baseline', cases, build: buildOk });
        expect(report).toMatchObject({ schema: 1, name: 'baseline', repeat: 1, seed: 1, totalRuns: 3, passes: 3, passRate: 1 });
        expect(report.stoppedEarly).toBeUndefined();
        expect(report.cases.map(c => [c.id, c.passes, c.passRate, c.tags])).toEqual([
            ['places an order', 1, 1, ['orders']], ['does not trade on a question', 1, 1, ['safety']], ['looks up before ordering', 1, 1, ['orders']],
        ]);
        expect(report.cases[0].runs[0].graders.map(g => [g.name, g.pass])).toEqual([['toolCalled(place_order)', true], ['noToolErrors', true], ['textMatches(ordered)', true]]);
        expect(report.cases[0].runs[0].result?.toolCalls.map(t => t.name)).toEqual(['place_order']);
        expect(report.startedAt).toBeUndefined();                 // no timing unless asked: the report is repeatable
        expect(report.cases[0].runs[0].durationMs).toBeUndefined();
    });

    it('the same suite twice gives the same report, byte for byte', async () => {
        const a = await evalSuite({ name: 's', cases, build: buildOk, repeat: 2 });
        const b = await evalSuite({ name: 's', cases, build: buildOk, repeat: 2 });
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('a regression breaks the suite without a model: a tool stops being called', async () => {
        const regressed = (c: EvalCase) => engineFor(c.id === 'places an order' ? [done('I will not')] : scripts[c.id]);
        const report = await evalSuite({ name: 'after', cases, build: regressed });
        expect(report.passes).toBe(2);
        const failed = report.cases[0].runs[0].graders.filter(g => !g.pass).map(g => g.name);
        expect(failed).toEqual(['toolCalled(place_order)', 'textMatches(ordered)']);
        expect(formatReport(report)).toContain('FAIL places an order: 0/1');
        expect(formatReport(report)).toContain('toolCalled(place_order) failed');
    });

    it('each run gets an id made of the suite, the case and the repetition, so its audit events can be found', async () => {
        const report = await evalSuite({ name: 'nightly', cases: [cases[0]], repeat: 2, build: buildOk });
        expect(report.cases[0].runs.map(r => r.result?.runId)).toEqual(['nightly/places an order/1', 'nightly/places an order/2']);
    });

    it('with tags only the cases that have one run', async () => {
        const report = await evalSuite({ name: 's', cases, build: buildOk, tags: ['safety'] });
        expect(report.cases.map(c => c.id)).toEqual(['does not trade on a question']);
    });

    it('setup runs before each run and its value reaches build and the graders', async () => {
        let n = 0;
        const seenBuild: unknown[] = [];
        const c: EvalCase = {
            id: 'w', input: 'buy', setup: () => ({ run: ++n }),
            expect: [grader('sees its setup', (_r, ctx) => ({ pass: (ctx.setup as { run: number }).run === n }))],
        };
        const report = await evalSuite({ name: 's', cases: [c], repeat: 2, build: (_c, run) => { seenBuild.push(run.setup); return engineFor([done('x')]); } });
        expect(seenBuild).toEqual([{ run: 1 }, { run: 2 }]);
        expect(report.passes).toBe(2);
    });
});

describe('evalSuite: repetitions and seeds', () => {
    it('each repetition gets the next seed, and a case that passes 2 of 3 says so', async () => {
        const seeds: number[] = [];
        const c: EvalCase = { id: 'flaky', input: 'buy', expect: [toolCalled('place_order')] };
        const report = await evalSuite({
            name: 'r', cases: [c], repeat: 3, seed: 10,
            build: (_c, run) => { seeds.push(run.seed); return engineFor(run.repetition === 2 ? [done('skipped')] : [order('c1'), done('ok')]); },
        });
        expect(seeds).toEqual([10, 11, 12]);
        expect(report.cases[0]).toMatchObject({ passes: 2, passRate: 0.6667 });
        expect(report.cases[0].runs.map(r => [r.repetition, r.seed, r.passed])).toEqual([[1, 10, true], [2, 11, false], [3, 12, true]]);
        expect(report).toMatchObject({ repeat: 3, seed: 10, totalRuns: 3, passes: 2 });
    });
});

describe('evalSuite: what it does not hide', () => {
    it('a run that throws is a failed run with its message, and the suite goes on', async () => {
        const report = await evalSuite({
            name: 'e', cases: [{ id: 'boom', input: 'x', expect: [textMatches('x')] }, cases[1]],
            build: (c) => { if (c.id === 'boom') throw new Error('provider down'); return engineFor(scripts[c.id]); },
        });
        expect(report.cases[0].runs[0]).toMatchObject({ passed: false, error: 'provider down', graders: [] });
        expect(report.cases[1].passes).toBe(1);
        expect(formatReport(report)).toContain('run 1 threw: provider down');
    });

    it('stops when a run reports budgetExceeded, and the report says it did not run everything', async () => {
        const fake = (budgetExceeded: boolean) => ({ run: async (): Promise<RunResult> => ({ text: '', toolCalls: [], errors: [], aborted: budgetExceeded, budgetExceeded, systemPrompts: [] }) }) as unknown as AgentEngine;
        const three: EvalCase[] = ['a', 'b', 'c'].map(id => ({ id, input: 'x', expect: [withinBudget()] }));
        const report = await evalSuite({ name: 'b', cases: three, build: c => fake(c.id === 'b') });
        expect(report.stoppedEarly).toBe('budget');
        expect(report.cases.map(c => c.id)).toEqual(['a', 'b']);            // c never ran
        expect(report.cases[1].runs[0].passed).toBe(false);
        expect(formatReport(report)).toContain('STOPPED EARLY');
        const all = await evalSuite({ name: 'b', cases: three, build: () => fake(false), stopOnBudget: false });
        expect(all.totalRuns).toBe(3);
    });
});

describe('graders that read the arguments need recordArgs', () => {
    const limit = (max: number) => toolCalled('place_order', { with: a => typeof a.sizePct === 'number' && a.sizePct <= max });
    const c: EvalCase = { id: 'sizing', input: 'buy', expect: [limit(15)] };

    it('with recordArgs, a call with sizePct 12 passes the limit of 15 and one with 40 does not', async () => {
        const ok = await evalSuite({ name: 's', cases: [c], build: () => engineFor([order('c1', { sizePct: 12 }), done('x')], { recordArgs: true }) });
        expect(ok.passes).toBe(1);
        const bad = await evalSuite({ name: 's', cases: [c], build: () => engineFor([order('c1', { sizePct: 40 }), done('x')], { recordArgs: true }) });
        expect(bad.passes).toBe(0);
        expect(bad.cases[0].runs[0].result?.toolCalls[0].args).toEqual({ sizePct: 40 });
    });

    it('without recordArgs the grader fails and says why, instead of passing by accident', async () => {
        const r = await evalSuite({ name: 's', cases: [c], build: () => engineFor([order('c1', { sizePct: 12 }), done('x')]) });
        expect(r.passes).toBe(0);
        expect(r.cases[0].runs[0].graders[0].note).toContain('recordArgs');
    });
});

describe('the other graders', () => {
    it('errorCode and noToolErrors read the code of a failed call', async () => {
        const c: EvalCase = { id: 'risk', input: 'x', expect: [errorCode('RISK_LIMIT', 'broken'), grader('has a failure', r => ({ pass: !r.toolCalls.every(t => t.success) }))] };
        const r = await evalSuite({ name: 's', cases: [c], build: () => engineFor([{ tool_calls: [{ id: 'c1', name: 'broken', args: {} }] }, done('x')]) });
        expect(r.passes).toBe(1);
        const ne = await evalSuite({ name: 's', cases: [{ id: 'n', input: 'x', expect: [noToolErrors()] }], build: () => engineFor([{ tool_calls: [{ id: 'c1', name: 'broken', args: {} }] }, done('x')]) });
        expect(ne.cases[0].runs[0].graders[0]).toMatchObject({ pass: false, note: 'failed: broken' });
    });

    it('an unnamed grader function is named after itself or by its position', async () => {
        function mine() { return { pass: true }; }
        const r = await evalSuite({ name: 's', cases: [{ id: 'n', input: 'x', expect: [mine, () => ({ pass: true })] }], build: () => engineFor([done('x')]) });
        expect(r.cases[0].runs[0].graders.map(g => g.name)).toEqual(['mine', 'grader#2']);
    });
});

describe('compare: the difference of two configurations', () => {
    const report = (name: string, rates: Array<[string, boolean[]]>) => ({
        schema: 1 as const, name, repeat: 1, seed: 1, totalRuns: 0, passes: 0, passRate: 0,
        cases: rates.map(([id, runs]) => ({ id, tags: [], runs: runs.map((p, i) => ({ repetition: i + 1, seed: i + 1, passed: p, graders: [] })), passes: runs.filter(Boolean).length, passRate: runs.filter(Boolean).length / runs.length })),
    });

    it('gives the difference per case and in total, over the cases both have, with the number of runs', () => {
        const a = report('before', [['x', [true, true, false, false]], ['y', [true, true]], ['onlyA', [true]]]);
        const b = report('after', [['x', [true, true, true, false]], ['y', [false, false]], ['onlyB', [true]]]);
        const c = compare(a, b);
        expect(c.cases).toEqual([
            { id: 'x', aRate: 0.5, bRate: 0.75, delta: 0.25, aRuns: 4, bRuns: 4 },
            { id: 'y', aRate: 1, bRate: 0, delta: -1, aRuns: 2, bRuns: 2 },
        ]);
        expect(c).toMatchObject({ a: 'before', b: 'after', aRate: 0.6667, bRate: 0.5, aRuns: 6, bRuns: 6, onlyInA: ['onlyA'], onlyInB: ['onlyB'] });
        expect(c.delta).toBeCloseTo(-0.1667, 3);
        const text = formatComparison(c);
        expect(text).toContain('better x: 50% -> 75%');
        expect(text).toContain('worse  y: 100% -> 0%');
        expect(text).toContain('only in before: onlyA');
    });
});

describe('writeReport and readReport: a report survives the process', () => {
    const { mkdtempSync, rmSync, statSync, writeFileSync } = jest.requireActual('node:fs') as typeof import('node:fs');
    const { tmpdir } = jest.requireActual('node:os') as typeof import('node:os');
    const { join } = jest.requireActual('node:path') as typeof import('node:path');
    const { writeReport, readReport } = jest.requireActual('../index') as typeof import('../index');
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'evals-')); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it('what is read back is the report that was written, in a folder that did not exist, and compare works on it', async () => {
        const report = await evalSuite({ name: 'saved', cases, build: buildOk, repeat: 2 });
        const file = join(dir, 'deep', 'baseline.json');
        await writeReport(report, file);
        const back = await readReport(file);
        expect(back).toEqual(JSON.parse(JSON.stringify(report)));
        expect(compare(back, report).delta).toBe(0);
        if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    });

    it('a file that is not a report of this version is refused, with its name', async () => {
        const file = join(dir, 'other.json');
        writeFileSync(file, JSON.stringify({ schema: 2, name: 'x', cases: [] }));
        await expect(readReport(file)).rejects.toThrow(/other\.json is not an evaluation report.*schema 2/);
    });
});
