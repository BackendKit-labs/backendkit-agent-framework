import { isContextOverflowError } from '../contextOverflow';
import { ContextManager } from '../ContextManager';
import { AgentEngine } from '../AgentEngine';
import type { LLMMessage, LLMProvider } from '../../types';
import { buildRegistries, createMockTransport } from '../../__tests__/helpers';

const withStatus = (status: number, message: string) => Object.assign(new Error(message), { status });

describe('isContextOverflowError', () => {
    it.each([
        withStatus(400, "This model's maximum context length is 65536 tokens. However, you requested 70000 tokens"),
        withStatus(400, 'prompt is too long: 210000 tokens > 200000 maximum'),
        withStatus(413, 'Request too large: input is too long'),
        new Error('input is too long for the model; reduce the length of the messages'),
        Object.assign(new Error('boom'), { code: 'context_length_exceeded' }),
        new Error('Your request exceeds the model limit'),
    ])('detects %p', err => expect(isContextOverflowError(err)).toBe(true));

    it.each([
        withStatus(400, 'invalid tool schema'),
        withStatus(429, 'rate limited: too many tokens per minute'),
        withStatus(500, 'maximum context length internal error'),
        new Error('socket hang up'),
        'nope', null, undefined,
    ])('ignores %p', err => expect(isContextOverflowError(err)).toBe(false));
});

describe('ContextManager overflow budget', () => {
    const mk = () => new ContextManager({ maxTokens: 1000 }, {
        history: { getAll: () => [], replaceAll: () => undefined } as never,
        summarize: async () => 's', emit: () => undefined,
    });
    it('shrinks by 0.7 per overflow and never below 0.3', () => {
        const cm = mk();
        cm.noteOverflow(); expect(cm.effectiveMaxTokens).toBe(700);
        for (let i = 0; i < 10; i++) cm.noteOverflow();
        expect(cm.effectiveMaxTokens).toBe(300);
    });
});

const turn = (i: number) => `turn ${i}: ` + 'lorem ipsum '.repeat(40);
const DEEPSEEK = () => withStatus(400, "This model's maximum context length is 65536 tokens");

function build(chat: LLMProvider['chat'], context: object = {}) {
    const main: LLMProvider = { chat };
    const { agents, tools, providers } = buildRegistries(main);
    const { transport, events } = createMockTransport();
    const engine = new AgentEngine({ requireAgentIdentity: false,
        model: { provider: 'mock', id: 'mock' }, agents, tools, providers,
        defaultProvider: 'mock', transport, defaultAgentId: 'test-agent',
        context: { maxTokens: 100_000, keepRecentTurns: 2, strategy: 'drop', ...context },
    });
    return { engine, events };
}

describe('AgentEngine — retry after provider context overflow', () => {
    it('compacts and retries: the run ends well and the second request is smaller', async () => {
        const sizes: number[] = [];
        let calls = 0;
        const { engine, events } = build(async (messages, _t, cb) => {
            sizes.push(messages.length);
            if (++calls === 13) { cb.onError(DEEPSEEK()); return; }          // first call of the 13th run
            cb.onDone({ role: 'assistant', content: 'ok' });
        });
        for (let i = 0; i < 12; i++) await engine.run(turn(i));
        await engine.run(turn(12));
        expect(calls).toBe(14);
        expect(sizes[13]).toBeLessThan(sizes[12]);
        expect(events.some(e => e.type === 'error')).toBe(false);
        expect(events.some(e => e.type === 'system' && /context overflow/.test(e.text))).toBe(true);
    });

    it('emits the original error when history cannot shrink, after bounded attempts', async () => {
        let calls = 0;
        const { engine, events } = build(async (_m, _t, cb) => { calls++; cb.onError(DEEPSEEK()); });
        await engine.run('hello');
        expect(calls).toBe(1);
        const errors = events.filter(e => e.type === 'error');
        expect(errors).toHaveLength(1);
        expect((errors[0] as { message: string }).message).toMatch(/maximum context length/);
    });

    it('never retries more than twice per run', async () => {
        let calls = 0;
        const { engine, events } = build(async (_m, _t, cb) => { calls++; cb.onError(DEEPSEEK()); });
        for (let i = 0; i < 12; i++) await engine.run(turn(i)).catch(() => undefined);
        const before = calls;
        await engine.run(turn(99));
        expect(calls - before).toBeLessThanOrEqual(3);
        expect(events.filter(e => e.type === 'error').length).toBeGreaterThan(0);
    });

    it('overflowRetry: false reports the error immediately', async () => {
        let calls = 0;
        const { engine, events } = build(async (_m, _t, cb) => { calls++; cb.onError(DEEPSEEK()); }, { overflowRetry: false });
        for (let i = 0; i < 6; i++) await engine.run(turn(i));
        expect(calls).toBe(6);
        expect(events.filter(e => e.type === 'error')).toHaveLength(6);
    });
});
