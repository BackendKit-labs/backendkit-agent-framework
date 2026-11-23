/**
 * What the trading bench found (agent-framework-examples/trading-bot, FINDINGS.md), fixed.
 */
import { z } from 'zod';
import { createLearning } from '..';
import { InMemoryStore } from '../../agent-memory/stores/InMemoryStore';
import { createBaseEngine } from '../../engine/createBaseEngine';
import { MemoryAuditSink } from '../../governance/audit';
import { defineTool } from '../../tools/defineTool';
import type { AuditEvent } from '../../governance/types';
import type { AgentProfile, LLMProvider } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent } from '../../__tests__/helpers';

const DAY = 86_400_000;
const PRINCIPAL = { agentId: 'ap', sessionId: 's', chain: ['ap'] };
const call = (over: Partial<AuditEvent> = {}): AuditEvent => ({
    at: new Date().toISOString(), principal: PRINCIPAL, tool: 'place_order', argsHash: 'abcdef012345',
    decision: 'allow', outcome: 'ok', durationMs: 1, ...over,
});
const failure = (over: Partial<AuditEvent> = {}): AuditEvent => call({ outcome: 'error', errorCode: 'RISK_MAX_POSITION', ...over });
async function write(learning: ReturnType<typeof createLearning>, n: number, make: () => AuditEvent) {
    for (let i = 0; i < n; i++) await learning.sink.write(make());
}

describe('a lesson that works does not remove itself (the rate decides when a pattern enters, not when it leaves)', () => {
    it('the failures that made the pattern, then a flood of correct calls: the pattern and its lesson stay', async () => {
        const learning = createLearning({ rate: { minFailureRate: 0.5, minCalls: 8 } });
        await write(learning, 3, () => failure());
        expect(await learning.patterns()).toHaveLength(1);
        await write(learning, 500, () => call());
        expect(await learning.patterns()).toHaveLength(1);
        expect(await learning.lessonsFor('ap')).toContain('RISK_MAX_POSITION');
    });

    it('but a pattern that never passed the rate does not get in because of it', async () => {
        const learning = createLearning({ rate: { minFailureRate: 0.5, minCalls: 8 } });
        await write(learning, 500, () => call());
        await write(learning, 3, () => failure());
        expect(await learning.patterns()).toEqual([]);
    });

    // SPEC-0022 D1 replaces "it leaves when its failures leave the window, and has to pass the rate again to come back":
    // the bench showed that a lesson that works lost its failures to the window and went away, and the mistake came back.
    it('its failures leave the window: no pattern to show, the lesson stays while the subject is called, and the same failure is the same pattern', async () => {
        let clock = Date.now();
        const learning = createLearning({ now: () => new Date(clock), window: { days: 7 }, rate: { minFailureRate: 0.5, minCalls: 8 } });
        await write(learning, 3, () => failure({ at: new Date(clock).toISOString() }));
        await write(learning, 200, () => call({ at: new Date(clock).toISOString() }));
        expect(await learning.patterns()).toHaveLength(1);

        clock += 8 * DAY;
        expect(await learning.patterns()).toEqual([]);
        // The correct calls are still being made: the lesson is still in the prompt (SPEC-0022).
        await write(learning, 200, () => call({ at: new Date(clock).toISOString() }));
        expect(await learning.lessonsFor('ap')).toContain('RISK_MAX_POSITION');
        // And three new failures among them are the pattern it already was, not noise.
        await write(learning, 3, () => failure({ at: new Date(clock).toISOString() }));
        expect(await learning.patterns()).toHaveLength(1);
    });

    it('it stays qualified in the store, so a later process still knows', async () => {
        const counters = new InMemoryStore();
        const store = new InMemoryStore();
        const first = createLearning({ store, counters, rate: { minFailureRate: 0.5, minCalls: 8 } });
        await write(first, 3, () => failure());
        await write(first, 300, () => call());
        await first.flush();

        const second = createLearning({ store, counters, rate: { minFailureRate: 0.5, minCalls: 8 } });
        expect(await second.patterns()).toHaveLength(1);
    });

    it('the view of one agent has its own memory: what passed for one does not pass for the others', async () => {
        const learning = createLearning();
        const other = { ...PRINCIPAL, agentId: 'other' };
        await write(learning, 2000, () => call({ principal: other }));
        await write(learning, 3, () => failure());
        expect(await learning.lessonsFor('ap')).toContain('RISK_MAX_POSITION');
        expect(await learning.patterns()).toEqual([]);
    });
});

describe('malformed arguments are an error with a code, not a success', () => {
    const agent: AgentProfile = { ...testAgent, id: 'ap', allowedTools: ['place_order'], delegatesTo: [] };
    const tool = defineTool({
        name: 'place_order', description: 'order', input: z.object({ sizePct: z.number().max(25) }),
        execute: async () => 'ok',
    });

    function build(script: Parameters<typeof createScriptedProvider>[0], extra: Record<string, unknown> = {}) {
        const systems: string[] = [];
        const scripted = createScriptedProvider(script);
        const provider = { async chat(messages, t, cb, ...rest) {
            const sys = messages.find(m => m.role === 'system');
            if (sys?.content) systems.push(sys.content as string);
            return scripted.chat(messages, t, cb, ...rest);
        } } as LLMProvider;
        const { transport, events } = createMockTransport();
        const sink = new MemoryAuditSink();
        const engine = createBaseEngine({ requireAgentIdentity: false,
            providers: { mock: provider }, defaultProvider: 'mock', agents: [agent], defaultAgent: agent.id, tools: [tool],
            transport, workingDir: process.cwd(), iterationMode: 'auto', audit: sink, ...extra,
        });
        return { engine, systems, sink, events };
    }

    it('the audit event is an error with the code INVALID_ARGUMENTS, and the model sees the same text as before', async () => {
        const { engine, sink, events } = build([{ tool_calls: [{ id: '1', name: 'place_order', args: { sizePct: 500 } }] }, { content: 'done' }]);
        await engine.run('go');
        expect(sink.events[0]).toMatchObject({ tool: 'place_order', outcome: 'error', errorCode: 'INVALID_ARGUMENTS' });
        const shown = events.find(e => e.type === 'tool_result') as { preview: string; success: boolean };
        expect(shown.success).toBe(false);
        expect(shown.preview).toMatch(/^Error: Invalid arguments for tool "place_order"/);
    });

    it('a model that keeps sending malformed arguments learns it, with the hint the engine knows', async () => {
        const learning = createLearning();
        const bad = (id: string) => ({ tool_calls: [{ id, name: 'place_order', args: { sizePct: 500 } }] });
        const { engine, systems } = build([bad('1'), bad('2'), bad('3'), { content: 'done' }, { content: 'again' }], { learning });
        await engine.run('go');
        await engine.run('again');
        expect(systems[systems.length - 1]).toContain('### place_order\n- INVALID_ARGUMENTS: The arguments did not match the schema of the tool');
    });

    it('the author of the tool can say it better for that code', async () => {
        const learning = createLearning({ threshold: 1 });
        learning.registerHints('place_order', { INVALID_ARGUMENTS: 'sizePct is a percentage between 1 and 25.', '*': 'Check the order.' });
        await learning.sink.write(failure({ errorCode: 'INVALID_ARGUMENTS' }));
        expect(await learning.lessonsFor('ap')).toContain('- INVALID_ARGUMENTS: sizePct is a percentage between 1 and 25.');
    });
});

describe('a lesson says the advice, not the symbol of the last experience', () => {
    it('with a detail, the line is the kind and the detail, without the situation', async () => {
        const learning = createLearning({ threshold: 3, rate: false });
        for (const symbol of ['AAA', 'BBB', 'CCC']) {
            await learning.record({
                agentId: 'ap', domain: 'trade', subject: 'breakout/trend_flat', kind: 'false_breakout',
                situation: `${symbol} breakout entry`, action: 'buy', detail: 'Wait for SMA20 to be above SMA50.',
            });
        }
        const text = (await learning.lessonsFor('ap'))!;
        expect(text).toContain('- false_breakout keeps happening: Wait for SMA20 to be above SMA50.');
        expect(text).not.toMatch(/AAA|BBB|CCC/);
    });

    it('without a detail, the situation is all there is', async () => {
        const learning = createLearning({ threshold: 1, rate: false });
        await learning.record({ agentId: 'ap', domain: 'qa', subject: 'x', kind: 'bad', situation: 'checking the total', action: 'a' });
        expect(await learning.lessonsFor('ap')).toContain('- bad keeps happening. checking the total');
    });
});
