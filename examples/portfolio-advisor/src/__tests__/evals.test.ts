/**
 * The evaluation suite of the advisor (`advisor-evals.ts`), run by `evalSuite` of `agent-testkit` over a scripted model. What it measures is the SYSTEM
 * around the model; the tests check that the suite itself can tell a good configuration from a bad one, which is what makes it worth running against a
 * real model: a suite that passes everything proves nothing.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compare, evalSuite, formatReport, readReport, writeReport } from '@backendkit-labs/agent-testkit';
import { CASES, EXECUTOR, buildAdvisorEval, type EvalBuild } from '../index';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'evals-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (name: string, config: Partial<EvalBuild> = {}, repeat = 2) => evalSuite({ name, cases: CASES, repeat, build: buildAdvisorEval({ dir, ...config }) });
/** A configuration that is worse on purpose: the executor holds a power ten times larger than it should. */
const looser: Partial<EvalBuild> = { mutate: (o, op) => { o.credentials[EXECUTOR] = op.credentialFor(EXECUTOR, { maxAmount: 50_000, maxShares: 1_000 }); } };

describe('the suite of the advisor', () => {
    it('passes every case, in every repetition, with the configuration that is meant', async () => {
        const report = await run('as designed');
        expect(report.cases.map(c => c.id)).toEqual(CASES.map(c => c.id));
        expect(report.totalRuns).toBe(CASES.length * 2);
        expect(report.passRate).toBe(1);
        expect(formatReport(report)).toContain('as designed');
    });

    it('is repeatable: the same suite over the same scripts gives the same report, byte for byte', async () => {
        const a = await run('same'), b = await run('same');
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    });

    it('tells a worse configuration from the right one: with a looser power the two cases of limits fail and the others do not', async () => {
        const good = await run('as designed');
        const bad = await run('looser power', looser);
        expect(bad.passRate).toBeLessThan(1);
        const diff = compare(good, bad);
        expect(diff.cases.filter(c => c.delta < 0).map(c => c.id)).toEqual([
            'an order above the money limit is not sent without a person',
            'an order above the shares limit is not sent without a person',
        ]);
        expect(diff.cases.filter(c => c.delta === 0)).toHaveLength(CASES.length - 2);
        expect(diff.delta).toBeLessThan(0);
    });

    it('and the other way: with no power for the executor the case of the order inside the power fails, and the reads still pass', async () => {
        const noPower = await run('no power', { mutate: (o) => { delete o.credentials[EXECUTOR]; } });
        const failed = noPower.cases.filter(c => c.passRate < 1).map(c => c.id);
        expect(failed).toEqual(['an order inside the power is sent']);
    });

    it('the baseline can be saved and compared another day', async () => {
        const file = join(dir, 'baseline.json');
        await writeReport(await run('baseline'), file);
        const later = await run('later', looser);
        expect(compare(await readReport(file), later).delta).toBeLessThan(0);
    });

    it('a case with no script is an error that says which, not a silent pass', async () => {
        const report = await evalSuite({ name: 'x', cases: [{ ...CASES[0]!, id: 'a case nobody scripted' }], build: buildAdvisorEval({ dir }) });
        expect(report.passRate).toBe(0);
        expect(report.cases[0]!.runs[0]!.error).toMatch(/no script for the case "a case nobody scripted"/);
    });
});
