import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createLearning, FileRuleStore } from '..';
import { ToolArgumentError, ToolError } from '../../tools/tool-error';
import { errorCodeOf } from '../../engine/error-code';

const HUMAN = { kind: 'human', id: 'ana' } as const;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bk-learning-dir-'));
const PRINCIPAL = { agentId: 'ap', sessionId: 's', chain: ['ap'] };
const failure = () => ({
    at: new Date().toISOString(), principal: PRINCIPAL, tool: 'post_invoice', argsHash: 'abcdef012345',
    decision: 'allow' as const, outcome: 'error' as const, errorCode: 'E_X', durationMs: 1,
});

describe('createLearning({ dir })', () => {
    it('keeps everything under the directory, with the names coding has always used, and a later instance finds it', async () => {
        const dir = tmp();
        try {
            const a = createLearning({ dir, threshold: 2 });
            await a.sink.write(failure());
            await a.sink.write(failure());
            await a.teach({ text: 'Remember me.' }, HUMAN);
            await a.addRule({ rule: { tool: 'x', effect: 'ask' } }, HUMAN);
            await a.flush();
            expect(fs.readdirSync(dir).sort()).toEqual(['counters.json', 'experiences.json', 'lessons.json', 'proposals', 'rules.json']);
            expect(fs.readdirSync(path.join(dir, 'proposals')).length).toBeGreaterThan(0);

            const b = createLearning({ dir, threshold: 2 });
            expect((await b.experiences()).length).toBe(2);
            expect((await b.proposals()).length).toBe(1);
            expect(await b.taught()).toHaveLength(1);
            expect(await b.rules.list()).toHaveLength(1);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('a store passed explicitly replaces its file', async () => {
        const dir = tmp();
        const other = path.join(dir, 'elsewhere.json');
        try {
            const learning = createLearning({ dir, rules: new FileRuleStore(other) });
            await learning.addRule({ rule: { tool: 'x', effect: 'ask' } }, HUMAN);
            expect(fs.existsSync(other)).toBe(true);
            expect(fs.existsSync(path.join(dir, 'rules.json'))).toBe(false);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('without dir nothing is written', async () => {
        const learning = createLearning();
        await learning.teach({ text: 'x' }, HUMAN);
        expect(await learning.taught()).toHaveLength(1);
    });
});

describe('trackOutcome', () => {
    it('a success counts against its subject and leaves no experience; a failure is recorded', async () => {
        const learning = createLearning({ threshold: 3, rate: { minFailureRate: 0.5, minCalls: 8 } });
        for (let i = 0; i < 30; i++) await learning.trackOutcome({ agentId: 'ap', domain: 'qa', subject: 'totals', ok: true });
        for (let i = 0; i < 3; i++) await learning.trackOutcome({ agentId: 'ap', domain: 'qa', subject: 'totals', ok: false, kind: 'wrong_total', detail: 'Add the lines again.' });
        expect(await learning.experiences()).toHaveLength(3);
        expect(await learning.patterns()).toEqual([]); // 3 among 33 is noise
        for (let i = 0; i < 5; i++) await learning.trackOutcome({ agentId: 'ap', domain: 'qa', subject: 'rare', ok: false, kind: 'bad' });
        expect((await learning.patterns()).map(p => p.key)).toEqual(['qa:bad:rare']);
    });

    it('fills in what is missing, and a success without a subject is refused instead of being silently lost', async () => {
        const learning = createLearning();
        const e = await learning.trackOutcome({ agentId: 'ap', domain: 'qa', subject: 'totals', ok: false });
        expect(e).toMatchObject({ kind: 'failure', outcome: 'failure', situation: 'qa totals', action: 'totals' });
        await expect(learning.trackOutcome({ agentId: 'ap', domain: 'qa', subject: ' ', ok: true })).rejects.toThrow(/subject/);
        await expect(learning.trackOutcome({ agentId: 'ap', domain: 'qa', subject: undefined as never, ok: true })).rejects.toThrow(/subject/);
    });
});

describe('ToolError', () => {
    it('carries a code the engine puts in the audit, and ToolArgumentError is one', () => {
        const e = new ToolError('RISK_MAX_POSITION', 'too big');
        expect(e).toBeInstanceOf(Error);
        expect(e.code).toBe('RISK_MAX_POSITION');
        expect(errorCodeOf(e)).toBe('RISK_MAX_POSITION');
        const a = new ToolArgumentError('t', 'x: bad');
        expect(a).toBeInstanceOf(ToolError);
        expect(a.code).toBe('INVALID_ARGUMENTS');
        expect(errorCodeOf(new ToolError('has spaces and a message', 'm'))).toBeUndefined();
    });
});
