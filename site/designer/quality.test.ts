/**
 * SPEC-0040 F2. Two parts:
 *  - OFFLINE (always runs, CI): the property checks themselves, proved against the hand-written designs and against designs
 *    mutated to be wrong. This shows the checks catch what they claim to, with no model involved.
 *  - LIVE (DESIGNER_LIVE=1 and DEEPSEEK_API_KEY): the measurement F2 asks for. Each task goes to a real model, the design is checked
 *    against its expectations, and ONE summary line is printed with the pass rate, the first-try rate and the tokens spent.
 *    It does not assert a pass rate: a measurement reports a number, and the number goes into the report, not into a threshold here.
 *
 * Live run: DESIGNER_LIVE=1 node --test site/designer/quality.test.ts   (the key is read from the environment, never printed)
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkExpectation, QUALITY_CASES, type Expectation } from './quality.ts';
import { DesignSchema } from './schema.ts';
import { generateDesign } from './generate.ts';
import { DEEPSEEK, openAiCompatible } from './providers.ts';

const load = (name: string) => DesignSchema.parse(JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('quality checks (offline)', () => {
    test('the hand-written designs satisfy the expectations of their own kind of task', () => {
        const byCase: Array<[string, string]> = [['refunds', 'refunds'], ['triage', 'support-triage'], ['report', 'report-readonly'], ['invoices', 'invoice-reconciliation']];
        for (const [caseId, fixture] of byCase) {
            const c = QUALITY_CASES.find(q => q.id === caseId)!;
            // The fixtures were written to be good designs: where one lacks a property a case demands, the case or the fixture is wrong.
            assert.deepEqual(checkExpectation(load(fixture), c.expect), [], `${caseId} against ${fixture}`);
        }
    });

    test('a payment design with no destructive tool is caught', () => {
        const spec = clone(load('invoice-reconciliation'));
        for (const t of spec.tools) if (t.effect === 'destructive') t.effect = 'write';
        const failures = checkExpectation(spec, { hasDestructiveTool: true });
        assert.equal(failures[0]?.property, 'hasDestructiveTool');
    });

    test('an unconditional allow on an irreversible tool is caught', () => {
        const spec = clone(load('refunds'));
        const tool = spec.tools.find(t => t.effect === 'destructive')!;
        spec.governance.rules.push({ id: 'let-it-run', tool: tool.name, effect: 'allow', reason: 'no questions asked' });
        const failures = checkExpectation(spec, { destructiveNeverAllowedUnconditionally: true });
        assert.equal(failures.length, 1);
        assert.match(failures[0].reason, /allows it with no condition/);
    });

    test('an allow with a condition on an irreversible tool is not an unconditional allow', () => {
        const spec = clone(load('refunds'));
        const tool = spec.tools.find(t => t.effect === 'destructive')!;
        spec.governance.rules = spec.governance.rules.filter(r => !(r.tool === tool.name && r.effect === 'allow' && !r.when));
        spec.governance.rules.push({ id: 'small-ones', tool: tool.name, effect: 'allow', reason: 'small amounts are routine', when: { field: 'amount', op: '<=', value: 50 } });
        assert.deepEqual(checkExpectation(spec, { destructiveNeverAllowedUnconditionally: true }), []);
    });

    test('a pure query that asks for approval is caught, and a read-only task that writes is caught', () => {
        const spec = clone(load('report-readonly'));
        spec.governance.rules.push({ id: 'pointless', tool: spec.tools[0].name, effect: 'ask', reason: 'ask just in case' });
        assert.equal(checkExpectation(spec, { asksNoone: true })[0]?.property, 'asksNoone');
        spec.tools[0].effect = 'write';
        assert.equal(checkExpectation(spec, { readOnly: true })[0]?.property, 'readOnly');
    });

    test('missing four-eyes and missing approver roles are caught', () => {
        const spec = clone(load('refunds'));
        spec.governance.fourEyes = false;
        for (const r of spec.governance.rules) delete r.approverRoles;
        const props = checkExpectation(spec, { fourEyes: true, approverRoles: true }).map(f => f.property).sort();
        assert.deepEqual(props, ['approverRoles', 'fourEyes']);
    });

    test('a case with no expectations passes anything', () => {
        const none: Expectation = {};
        assert.deepEqual(checkExpectation(load('report-readonly'), none), []);
    });

    test('every live case states at least one property, and ids are unique', () => {
        assert.ok(QUALITY_CASES.length >= 5);
        assert.equal(new Set(QUALITY_CASES.map(c => c.id)).size, QUALITY_CASES.length);
        for (const c of QUALITY_CASES) assert.ok(Object.keys(c.expect).length > 0, c.id);
    });
});

const key = process.env.DEEPSEEK_API_KEY;
const live = process.env.DESIGNER_LIVE === '1' && !!key;

describe('quality measurement (live)', { skip: live ? false : 'set DESIGNER_LIVE=1 and DEEPSEEK_API_KEY to run it' }, () => {
    test('measure: valid designs, first-try rate, property pass rate and tokens, per task', { timeout: 20 * 60_000 }, async () => {
        const complete = openAiCompatible(DEEPSEEK, key ?? '');
        const rows: Array<Record<string, unknown>> = [];
        let valid = 0, firstTry = 0, propsHeld = 0, propsTotal = 0, tokensIn = 0, tokensOut = 0;
        for (const c of QUALITY_CASES) {
            const result = await generateDesign(c.task, complete);
            if (!result.ok) {
                // A provider failure is not a bad design: it is reported as such and does not count against the model.
                rows.push({ id: c.id, ok: false, stage: result.stage, reason: result.reason.slice(0, 160) });
                continue;
            }
            valid++;
            if (result.attempts === 1) firstTry++;
            tokensIn += result.usage.inputTokens; tokensOut += result.usage.outputTokens;
            const failures = checkExpectation(result.spec, c.expect);
            propsTotal += Object.keys(c.expect).length;
            propsHeld += Object.keys(c.expect).length - failures.length;
            rows.push({ id: c.id, ok: true, attempts: result.attempts, failures: failures.map(f => `${f.property}: ${f.reason}`) });
        }
        console.log(JSON.stringify({
            provider: DEEPSEEK.id, model: DEEPSEEK.model, tasks: QUALITY_CASES.length, valid, firstTry,
            propertiesHeld: `${propsHeld}/${propsTotal}`, tokens: { input: tokensIn, output: tokensOut }, rows,
        }, null, 2));
        // The only hard assertion: the run produced something to report. The numbers are the result, not a pass/fail.
        assert.ok(rows.length === QUALITY_CASES.length);
    });
});
