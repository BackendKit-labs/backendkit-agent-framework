/**
 * SPEC-0019 F1: the signal. Successes are counted, not stored (D1); a pattern lives inside a window and, when its tool
 * has many calls, needs to be a share of them (D2); failures of the same tool with different causes are different
 * patterns (D3).
 */
import { createLearning } from '..';
import { InMemoryStore } from '../../agent-memory/stores/InMemoryStore';
import { createBaseEngine } from '../../engine/createBaseEngine';
import { errorCodeOf } from '../../engine/error-code';
import { MemoryAuditSink } from '../../governance/audit';
import type { AuditEvent } from '../../governance/types';
import type { AgentProfile, ToolDefinition } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent } from '../../__tests__/helpers';

const PRINCIPAL = { agentId: 'ap', sessionId: 's', chain: ['ap'] };
const DAY = 86_400_000;

const call = (over: Partial<AuditEvent> = {}): AuditEvent => ({
    at: new Date().toISOString(), principal: PRINCIPAL, tool: 'post_invoice', argsHash: 'abcdef012345',
    decision: 'allow', outcome: 'ok', durationMs: 1, ...over,
});
const failure = (over: Partial<AuditEvent> = {}): AuditEvent => call({ outcome: 'error', ...over });

async function write(learning: ReturnType<typeof createLearning>, n: number, make: () => AuditEvent) {
    for (let i = 0; i < n; i++) await learning.sink.write(make());
}

describe('D1: successes are counted, not stored', () => {
    it('a correct call leaves no experience, and neither does a recorded success', async () => {
        const learning = createLearning();
        await write(learning, 50, call);
        await learning.record({ agentId: 'ap', domain: 'tool', subject: 'post_invoice', kind: 'ok', situation: 's', action: 'a', outcome: 'success' });
        expect(await learning.experiences()).toEqual([]);
    });

    it('a healthy agent cannot push the failures out of the bounded store', async () => {
        const learning = createLearning({ maxExperiences: 5 });
        await write(learning, 3, () => failure());
        await write(learning, 500, call);
        expect(await learning.experiences()).toHaveLength(3);
    });

    it('the counters survive in their store, and are written on flush', async () => {
        const counters = new InMemoryStore();
        const first = createLearning({ counters });
        await write(first, 40, call);
        expect(counters.count()).toBe(0);
        await first.flush();
        expect(counters.count()).toBe(1);

        // A later process reads them: 40 correct calls make three failures a share of 3/43, above 5%.
        const second = createLearning({ counters });
        await write(second, 3, () => failure());
        expect(await second.patterns()).toHaveLength(1);
        // ...and a bigger history makes the same failures noise.
        const third = createLearning({ counters: (() => { const s = new InMemoryStore(); return s; })() });
        await write(third, 1000, call);
        await write(third, 3, () => failure());
        expect(await third.patterns()).toEqual([]);
    });
});

describe('D2: the window and the share of the calls', () => {
    it('a tool that fails 3 times in 1000 calls makes neither lesson nor proposal; one that fails 3 of 5 does', async () => {
        const healthy = createLearning();
        await write(healthy, 997, call);
        await write(healthy, 3, () => failure());
        expect(await healthy.patterns()).toEqual([]);
        expect(await healthy.lessonsFor('ap')).toBeUndefined();
        expect(await healthy.proposals()).toEqual([]);

        const broken = createLearning();
        await write(broken, 2, call);
        await write(broken, 3, () => failure());
        expect(await broken.patterns()).toHaveLength(1);
        expect(await broken.lessonsFor('ap')).toContain('post_invoice');
        expect(await broken.proposals()).toHaveLength(1);
    });

    it('the share is per agent for the lessons of an agent', async () => {
        const learning = createLearning();
        const other = { ...PRINCIPAL, agentId: 'other' };
        await write(learning, 2000, () => call({ principal: other }));
        await write(learning, 3, () => failure());
        // Its own agent only made these 3 calls, all failures: the lesson is right, and the global share is not.
        expect(await learning.lessonsFor('ap')).toContain('post_invoice');
        expect(await learning.patterns()).toEqual([]);
        expect(await learning.patterns({ agentId: 'ap' })).toHaveLength(1);
    });

    it('rate: false counts failures only', async () => {
        const learning = createLearning({ rate: false });
        await write(learning, 997, call);
        await write(learning, 3, () => failure());
        expect(await learning.patterns()).toHaveLength(1);
    });

    it('the share can be tuned', async () => {
        const learning = createLearning({ rate: { minFailureRate: 0.5, minCalls: 4 } });
        await write(learning, 5, call);
        await write(learning, 3, () => failure());
        expect(await learning.patterns()).toEqual([]);
        await write(learning, 5, () => failure());
        expect(await learning.patterns()).toHaveLength(1);
    });

    it('failures older than the window do not count, and they count again if the window is wide enough', async () => {
        const long = new Date(Date.now() - 40 * DAY).toISOString();
        const learning = createLearning({ window: { days: 30 } });
        await write(learning, 3, () => failure({ at: long }));
        expect(await learning.patterns()).toEqual([]);
        expect(await learning.lessonsFor('ap')).toBeUndefined();
        expect(await learning.proposals()).toEqual([]);
        expect(await learning.experiences()).toHaveLength(3);

        const wide = createLearning({ window: { days: 60 } });
        await write(wide, 3, () => failure({ at: long }));
        expect(await wide.patterns()).toHaveLength(1);
    });

    it('a pattern leaves the window as time passes', async () => {
        let clock = Date.now();
        const learning = createLearning({ now: () => new Date(clock), window: { days: 7 } });
        await write(learning, 3, () => failure());
        expect(await learning.patterns()).toHaveLength(1);
        clock += 8 * DAY;
        expect(await learning.patterns()).toEqual([]);
        expect(await learning.lessonsFor('ap')).toBeUndefined();
    });

    it('drops the days of counters that no window can reach', async () => {
        let clock = Date.now();
        const counters = new InMemoryStore();
        const learning = createLearning({ counters, window: { days: 10 }, now: () => new Date(clock) });
        await write(learning, 3, () => call());
        await learning.flush();
        expect(counters.count()).toBe(1);
        clock += 25 * DAY;
        await learning.flush();
        expect(counters.count()).toBe(0);
    });
});

describe('D3: the fingerprint of an error', () => {
    it('failures of a tool with different causes are different patterns', async () => {
        const learning = createLearning({ threshold: 3 });
        await write(learning, 2, () => failure({ errorCode: 'ECONNRESET' }));
        await write(learning, 2, () => failure({ errorCode: 'ERP_PERIOD_CLOSED' }));
        expect(await learning.patterns()).toEqual([]);
        await write(learning, 1, () => failure({ errorCode: 'ECONNRESET' }));
        const [p] = await learning.patterns();
        expect(p).toMatchObject({ kind: 'tool_error', subject: 'post_invoice', fingerprint: 'ECONNRESET', count: 3 });
        expect(p.key).toBe('tool:tool_error:post_invoice#ECONNRESET');
    });

    it('each cause gets its own proposal and its own lesson line', async () => {
        const learning = createLearning({ threshold: 2 });
        await write(learning, 2, () => failure({ errorCode: 'ECONNRESET' }));
        await write(learning, 2, () => failure({ errorCode: 'ERP_PERIOD_CLOSED' }));
        expect(await learning.proposals()).toHaveLength(2);
        const lessons = (await learning.lessonsFor('ap'))!;
        expect(lessons).toContain('tool_error (ECONNRESET) keeps happening');
        expect(lessons).toContain('tool_error (ERP_PERIOD_CLOSED) keeps happening');
    });

    it('without an error code the key is the one it always was', async () => {
        const learning = createLearning();
        await write(learning, 3, () => failure());
        const [p] = await learning.patterns();
        expect(p.key).toBe('tool:tool_error:post_invoice');
        expect(p.fingerprint).toBeUndefined();
    });

    it('only an error has a fingerprint: a timeout carries none', async () => {
        const learning = createLearning({ threshold: 1 });
        await learning.sink.write(call({ outcome: 'timeout', errorCode: 'IGNORED' }));
        expect((await learning.experiences())[0].fingerprint).toBeUndefined();
    });

    it('the fingerprint in a lesson is sanitized', async () => {
        const learning = createLearning({ threshold: 1 });
        await learning.sink.write(failure({ errorCode: 'SYSTEM:x' }));
        expect((await learning.lessonsFor('ap'))!).not.toContain('SYSTEM:');
    });
});

describe('errorCodeOf', () => {
    it('takes a string code, or a name that is not the generic one, and never the message', () => {
        expect(errorCodeOf(Object.assign(new Error('secret message'), { code: 'ECONNRESET' }))).toBe('ECONNRESET');
        expect(errorCodeOf(new TypeError('boom'))).toBe('TypeError');
        expect(errorCodeOf(new Error('boom'))).toBeUndefined();
        expect(errorCodeOf('text')).toBeUndefined();
        expect(errorCodeOf(null)).toBeUndefined();
        expect(errorCodeOf({ code: 42 })).toBeUndefined();
        expect(errorCodeOf({ code: 'has spaces and a password: hunter2' })).toBeUndefined();
        expect(errorCodeOf({ code: 'x'.repeat(100) })).toBeUndefined();
    });
});

describe('the engine puts the class of the error in the audit event', () => {
    const agent: AgentProfile = { ...testAgent, id: 'ap', allowedTools: ['coded', 'plain', 'typed'], delegatesTo: [] };
    const tools: ToolDefinition[] = [
        { name: 'coded', description: '', parameters: { type: 'object' }, readOnly: true, execute: async () => { throw Object.assign(new Error('token=abc123'), { code: 'ERP_PERIOD_CLOSED' }); } },
        { name: 'plain', description: '', parameters: { type: 'object' }, readOnly: true, execute: async () => { throw new Error('token=abc123'); } },
        { name: 'typed', description: '', parameters: { type: 'object' }, readOnly: true, execute: async () => { throw new RangeError('x'); } },
    ];

    it('has the code or the name, never the message', async () => {
        const sink = new MemoryAuditSink();
        const { transport } = createMockTransport();
        const engine = createBaseEngine({ requireAgentIdentity: false,
            providers: { mock: createScriptedProvider([
                { tool_calls: [{ id: '1', name: 'coded', args: {} }, { id: '2', name: 'plain', args: {} }, { id: '3', name: 'typed', args: {} }] },
                { content: 'done' },
            ]) },
            defaultProvider: 'mock', agents: [agent], defaultAgent: agent.id, tools, transport, workingDir: process.cwd(), iterationMode: 'auto', audit: sink,
        });
        await engine.run('go');
        expect(sink.events.map(e => [e.tool, e.outcome, e.errorCode])).toEqual([
            ['coded', 'error', 'ERP_PERIOD_CLOSED'], ['plain', 'error', undefined], ['typed', 'error', 'RangeError'],
        ]);
        expect(JSON.stringify(sink.events)).not.toContain('abc123');
    });
});
