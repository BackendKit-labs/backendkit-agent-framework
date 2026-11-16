/**
 * SPEC-0022: the life of a lesson. A lesson that works must not leave because it works (the failures age out of the window
 * while the agent keeps calling the subject), it leaves when the subject goes quiet or a person resolves it, its text
 * does not change when the process restarts, and the proposal shows the evidence (calls and rate).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createLearning } from '..';
import { InMemoryStore } from '../../agent-memory/stores/InMemoryStore';
import type { AuditEvent } from '../../governance/types';

const DAY = 86_400_000;
const HUMAN = { kind: 'human', id: 'ana' } as const;
const AGENT = { kind: 'agent', id: 'ap' } as const;
const RATE = { minFailureRate: 0.5, minCalls: 8 };
const KEY = 'trade:false_breakout:breakout';

function world(options: Parameters<typeof createLearning>[0] = {}) {
    const clock = { now: Date.parse('2030-03-01T12:00:00Z') };
    const at = () => new Date(clock.now).toISOString();
    const learning = createLearning({ now: () => new Date(clock.now), window: { days: 7 }, rate: RATE, ...options });
    const fail = async (n: number, detail = 'Wait for a trend.', subject = 'breakout', kind = 'false_breakout') => {
        for (let i = 0; i < n; i++) await learning.trackOutcome({ agentId: 'ap', domain: 'trade', subject, ok: false, kind, detail, at: at() });
    };
    const win = async (n: number, subject = 'breakout') => {
        for (let i = 0; i < n; i++) await learning.trackOutcome({ agentId: 'ap', domain: 'trade', subject, ok: true, at: at() });
    };
    /** `days` days go by; with `calls`, the subject is called once a day. */
    const pass = async (days: number, calls = false) => {
        for (let d = 0; d < days; d++) {
            clock.now += DAY;
            if (calls) await win(1);
        }
    };
    return { learning, clock, at, fail, win, pass };
}

describe('the lesson stays while its subject is still being called', () => {
    it('its failures leave the window, the agent keeps calling the subject, and the lesson is still in the prompt', async () => {
        const w = world();
        await w.fail(3);
        await w.win(2);
        expect(await w.learning.lessonsFor('ap')).toContain('false_breakout keeps happening: Wait for a trend.');
        await w.pass(10, true);
        expect(await w.learning.patterns()).toEqual([]); // there is no failure left to show
        expect(await w.learning.lessonsFor('ap')).toContain('false_breakout keeps happening: Wait for a trend.');
    });

    it('the subject goes quiet for `quietAfterDays` (the window by default): the lesson leaves', async () => {
        const w = world();
        await w.fail(3);
        await w.win(2);
        await w.pass(6);
        expect(await w.learning.lessonsFor('ap')).toContain('false_breakout');
        await w.pass(2);
        expect(await w.learning.lessonsFor('ap')).toBeUndefined();
    });

    it('`quietAfterDays` is configurable', async () => {
        const w = world({ quietAfterDays: 30 });
        await w.fail(3);
        await w.win(2);
        await w.pass(20);
        expect(await w.learning.lessonsFor('ap')).toContain('false_breakout');
        await w.pass(15);
        expect(await w.learning.lessonsFor('ap')).toBeUndefined();
    });

    it('a pattern without a subject has no calls to count: it leaves with its window, as it always did', async () => {
        const w = world({ rate: false });
        for (let i = 0; i < 3; i++) await w.learning.record({ agentId: 'ap', domain: 'audit', kind: 'finding', situation: 'sit', action: 'a', at: w.at() });
        expect(await w.learning.lessonsFor('ap')).toContain('finding keeps happening');
        await w.pass(8);
        expect(await w.learning.lessonsFor('ap')).toBeUndefined();
    });

    it('a lesson that stayed does not take the place of a new problem: the patterns with failures in the window come first', async () => {
        const w = world({ lessons: { maxLessons: 2, maxPerUnit: 2 } });
        for (const subject of ['old_a', 'old_b']) { await w.fail(5, `fix ${subject}`, subject); await w.win(2, subject); }
        await w.pass(10);
        for (const subject of ['old_a', 'old_b']) await w.win(3, subject);
        await w.fail(3, 'new problem', 'fresh');
        await w.win(2, 'fresh');
        const text = (await w.learning.lessonsFor('ap'))!;
        expect(text).toContain('new problem');
        expect((text.match(/keeps happening/g) ?? []).length).toBe(2);
    });
});

describe('the text of a lesson does not change when the process restarts', () => {
    it('a later failure with another detail does not rewrite the line, in this process or in the next', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-lifecycle-'));
        try {
            const w = world({ dir });
            await w.fail(3, 'Wait for a trend.');
            await w.win(2);
            const first = await w.learning.lessonsFor('ap');
            await w.fail(1, 'A different thing the latest failure said.');
            expect(await w.learning.lessonsFor('ap')).toBe(first);
            await w.learning.flush();

            const next = createLearning({ dir, now: () => new Date(w.clock.now), window: { days: 7 }, rate: RATE });
            expect(await next.lessonsFor('ap')).toBe(first);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('and a restart keeps the lesson even when its experiences are gone from the window', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-lifecycle-'));
        try {
            const w = world({ dir });
            await w.fail(3);
            await w.win(2);
            const first = await w.learning.lessonsFor('ap');
            await w.pass(10, true);
            await w.learning.flush();
            const next = createLearning({ dir, now: () => new Date(w.clock.now), window: { days: 7 }, rate: RATE });
            expect(await next.lessonsFor('ap')).toBe(first);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('resolve: a person says it is solved', () => {
    it('hides the lesson, only for a person, and keeps the record', async () => {
        const w = world();
        await w.fail(3);
        await w.win(2);
        await expect(w.learning.resolve(KEY, AGENT)).rejects.toThrow(/human/);
        expect(await w.learning.lessonsFor('ap')).toContain('false_breakout');

        await w.learning.resolve(KEY, HUMAN, { reason: 'fixed upstream' });
        expect(await w.learning.lessonsFor('ap')).toBeUndefined();
        const [record] = await w.learning.records();
        expect(record).toMatchObject({ key: KEY, state: 'resolved', resolvedBy: HUMAN });
    });

    it('refuses a pattern that does not exist, and a lesson of another tenant is not touched', async () => {
        const w = world();
        await expect(w.learning.resolve('nope', HUMAN)).rejects.toThrow(/No pattern/);
        await w.learning.trackOutcome({ agentId: 'ap', tenantId: 't1', domain: 'trade', subject: 'breakout', ok: false, kind: 'false_breakout', at: w.at() });
        await w.learning.trackOutcome({ agentId: 'ap', tenantId: 't1', domain: 'trade', subject: 'breakout', ok: false, kind: 'false_breakout', at: w.at() });
        await w.learning.trackOutcome({ agentId: 'ap', tenantId: 't1', domain: 'trade', subject: 'breakout', ok: false, kind: 'false_breakout', at: w.at() });
        await expect(w.learning.resolve(KEY, HUMAN, { tenantId: 't2' })).rejects.toThrow(/No pattern/);
        expect(await w.learning.lessonsFor('ap', 't1')).toContain('false_breakout');
    });

    it('a resolved pattern that fails again after the resolution is active again, and the record says it came back', async () => {
        const w = world();
        await w.fail(3);
        await w.win(2);
        await w.learning.resolve(KEY, HUMAN);
        await w.pass(1);
        // The failures that were already in the window do not bring it back: only new ones do.
        await w.win(1);
        expect(await w.learning.lessonsFor('ap')).toBeUndefined();
        await w.fail(3);
        expect(await w.learning.lessonsFor('ap')).toContain('false_breakout');
        const [record] = await w.learning.records();
        expect(record.state).toBe('active');
        expect(record.reappeared).toMatchObject({ by: HUMAN });
    });
});

describe('the proposal shows its evidence', () => {
    const PRINCIPAL = { agentId: 'ap', sessionId: 's', chain: ['ap'] };
    const call = (over: Partial<AuditEvent> = {}): AuditEvent => ({
        at: new Date().toISOString(), principal: PRINCIPAL, tool: 'place_order', argsHash: 'abcdef012345', decision: 'allow', outcome: 'ok', durationMs: 1, ...over,
    });

    it('how many of the calls failed, not only how many failures there were', async () => {
        const learning = createLearning({ threshold: 3 });
        for (let i = 0; i < 7; i++) await learning.sink.write(call());
        for (let i = 0; i < 3; i++) await learning.sink.write(call({ outcome: 'error', errorCode: 'RISK_MAX_POSITION' }));
        const [proposal] = await learning.proposals();
        const evidence = (proposal.subject as { evidence: string }).evidence;
        expect(evidence).toMatch(/3 x tool_error on place_order/);
        expect(evidence).toContain('3 of 10 calls, 30%');
    });
});

describe('what a published 0.42 left in counters.json', () => {
    it('a pattern remembered as `qualified` still counts as having passed the rate', async () => {
        const store = new InMemoryStore();
        const counters = new InMemoryStore();
        const day = '2030-03-01';
        // The published code remembered the pattern in the view of the agent and in the one of all of them.
        for (const view of [`ap| ${KEY}`, `| ${KEY}`]) {
            counters.upsert(`q|${view}`, { id: `q|${view}`, createdAt: `${day}T00:00:00.000Z`, kind: 'qualified', key: view, day });
        }
        const clock = Date.parse('2030-03-01T12:00:00Z');
        const learning = createLearning({ store, counters, now: () => new Date(clock), window: { days: 7 }, rate: RATE });
        for (let i = 0; i < 300; i++) await learning.trackOutcome({ agentId: 'ap', domain: 'trade', subject: 'breakout', ok: true, at: new Date(clock).toISOString() });
        for (let i = 0; i < 3; i++) await learning.trackOutcome({ agentId: 'ap', domain: 'trade', subject: 'breakout', ok: false, kind: 'false_breakout', at: new Date(clock).toISOString() });
        expect((await learning.patterns()).map(p => p.key)).toEqual([KEY]);
    });
});

