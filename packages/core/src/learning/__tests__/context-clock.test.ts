/**
 * The context of an experience (judged apart within the same subject) and the simulated clock. Both change nothing for
 * whoever does not ask for them.
 */
import { createHash } from 'node:crypto';
import { createLearning } from '..';
import { InMemoryStore } from '../../agent-memory/stores/InMemoryStore';
import type { AuditEvent } from '../../governance/types';

const DAY = 86_400_000;
const PRINCIPAL = { agentId: 'ap', sessionId: 's', chain: ['ap'] };
const RATE = { minFailureRate: 0.5, minCalls: 8 };

describe('context: the same subject, judged apart by circumstances', () => {
    async function trades(learning: ReturnType<typeof createLearning>, context: string, wins: number, losses: number) {
        for (let i = 0; i < wins; i++) await learning.trackOutcome({ agentId: 'ap', domain: 'trade', subject: 'breakout', context, ok: true });
        for (let i = 0; i < losses; i++) {
            await learning.trackOutcome({ agentId: 'ap', domain: 'trade', subject: 'breakout', context, ok: false, kind: 'false_breakout', detail: 'Wait for a trend.' });
        }
    }

    it('breakouts in a flat trend (mostly losing) are a pattern and in an uptrend (mostly winning) are not, with one subject', async () => {
        const learning = createLearning({ rate: RATE });
        await trades(learning, 'trend_flat', 1, 5);
        await trades(learning, 'trend_up', 20, 5);
        const patterns = await learning.patterns();
        expect(patterns.map(p => p.key)).toEqual(['trade:false_breakout:breakout@trend_flat']);
        expect(patterns[0]).toMatchObject({ subject: 'breakout', context: 'trend_flat', count: 5 });
    });

    it('without a context, the same two groups are judged together (and the pattern is noise)', async () => {
        const learning = createLearning({ rate: RATE });
        // The mostly-winning group first: a pattern that entered the rate stays (hysteresis), so the order matters.
        for (const [wins, losses] of [[20, 5], [1, 5]]) {
            for (let i = 0; i < wins; i++) await learning.trackOutcome({ agentId: 'ap', domain: 'trade', subject: 'breakout', ok: true });
            for (let i = 0; i < losses; i++) await learning.trackOutcome({ agentId: 'ap', domain: 'trade', subject: 'breakout', ok: false, kind: 'false_breakout' });
        }
        expect(await learning.patterns()).toEqual([]);
    });

    it('the lesson names the context, under the unit of the subject, and ruleFor receives it', async () => {
        const seen: Array<string | undefined> = [];
        const learning = createLearning({ rate: RATE, ruleFor: p => { seen.push(p.context); return { block: p.context }; } });
        await trades(learning, 'trend_flat', 1, 5);
        expect(await learning.lessonsFor('ap')).toBe('## Lessons\n\n### breakout\n- false_breakout (trend_flat) keeps happening: Wait for a trend.');
        expect(seen).toContain('trend_flat');
        expect(await learning.proposals()).toHaveLength(1);
    });

    it('context and fingerprint go together in the line', async () => {
        const learning = createLearning({ threshold: 1, rate: false });
        await learning.record({ agentId: 'ap', domain: 'x', subject: 's', context: 'night', fingerprint: 'E1', kind: 'bad', situation: 'sit', action: 'a' });
        expect(await learning.lessonsFor('ap')).toContain('- bad (night, E1) keeps happening. sit');
    });

    it('without a context nothing changes: the key, the proposal and the lesson are the ones there always were', async () => {
        const learning = createLearning({ threshold: 3 });
        for (let i = 0; i < 3; i++) await learning.record({ agentId: 'ap', domain: 'trade', subject: 'x', kind: 'bad', situation: 'sit', action: 'a' });
        const [p] = await learning.patterns();
        expect(p.key).toBe('trade:bad:x');
        expect(p.context).toBeUndefined();
        const [proposal] = await learning.proposals();
        const oldId = `learn-${createHash('sha256').update('\u0000trade:bad:x').digest('hex').slice(0, 16)}`;
        expect(proposal?.id ?? oldId).toBe(oldId);
        expect(await learning.lessonsFor('ap')).toBe('## Lessons\n\n### x\n- bad keeps happening. sit');
    });

    it('counters written before there were contexts still count for experiences that have none', async () => {
        const counters = new InMemoryStore();
        const day = new Date().toISOString().slice(0, 10);
        // A bucket exactly as an earlier version wrote it: no `context`, and an id of five parts.
        const id = [day, '', 'ap', 'trade', 'x'].join('\u0000');
        counters.upsert(id, { id, createdAt: `${day}T00:00:00.000Z`, kind: 'ok-bucket', day, agentId: 'ap', domain: 'trade', subject: 'x', n: 200 });
        const learning = createLearning({ counters, rate: RATE });
        for (let i = 0; i < 3; i++) await learning.record({ agentId: 'ap', domain: 'trade', subject: 'x', kind: 'bad', situation: 's', action: 'a' });
        expect(await learning.patterns()).toEqual([]); // 3 among 200 correct calls is noise: the old bucket was read
    });
});

describe('stamp: "clock", a simulation in simulated time', () => {
    const call = (over: Partial<AuditEvent> = {}): AuditEvent => ({
        at: new Date().toISOString(), principal: PRINCIPAL, tool: 'place_order', argsHash: 'abcdef012345', decision: 'allow', outcome: 'ok', durationMs: 1, ...over,
    });
    const failure = () => call({ outcome: 'error', errorCode: 'E_X' });

    it('by default the experiences carry the time of the event, as always', async () => {
        const learning = createLearning({ now: () => new Date(Date.now() + 100 * DAY) });
        const at = new Date(Date.now() - DAY).toISOString();
        await learning.sink.write({ ...failure(), at });
        expect((await learning.experiences())[0].at).toBe(at);
    });

    it('with the clock, experiences from the sink, the counters and the window all agree on simulated time', async () => {
        let clock = Date.UTC(2030, 0, 1);
        const learning = createLearning({ now: () => new Date(clock), stamp: 'clock', window: { days: 7 }, rate: RATE });
        // Real event times are in 2026: the simulated clock is the one that counts.
        for (let i = 0; i < 3; i++) await learning.sink.write(failure());
        for (let i = 0; i < 2; i++) await learning.sink.write(call());
        expect((await learning.experiences()).every(e => e.at.startsWith('2030-01-01'))).toBe(true);
        expect(await learning.patterns()).toHaveLength(1);

        clock += 8 * DAY;
        expect(await learning.patterns()).toEqual([]);       // out of the simulated window
        expect(await learning.lessonsFor('ap')).toBeUndefined();
    });

    it('with the clock, record uses the simulated time unless it is given its own', async () => {
        const clock = Date.UTC(2031, 5, 15);
        const learning = createLearning({ now: () => new Date(clock), stamp: 'clock' });
        const a = await learning.record({ agentId: 'ap', domain: 'd', kind: 'k', situation: 's', action: 'a' });
        expect(a.at).toBe(new Date(clock).toISOString());
        const own = new Date(Date.UTC(2031, 5, 10)).toISOString();
        const b = await learning.record({ agentId: 'ap', domain: 'd', kind: 'k', situation: 's', action: 'a', at: own });
        expect(b.at).toBe(own);
    });

    it('a long simulation: only the failures of the last window count', async () => {
        let clock = Date.UTC(2030, 0, 1);
        const learning = createLearning({ now: () => new Date(clock), stamp: 'clock', window: { days: 30 }, rate: false });
        for (let d = 0; d < 120; d++) {
            if (d % 10 === 0) await learning.sink.write(failure());   // a failure every 10 simulated days
            clock += DAY;
        }
        const [p] = await learning.patterns();
        expect(p.count).toBe(3);                                    // the ones of the last 30 days, not the 12 of the whole run
    });
});
