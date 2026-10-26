import { AgentEngine } from '../AgentEngine';
import type { LLMMessage, LLMProvider } from '../../types';
import { buildRegistries, createMockTransport } from '../../__tests__/helpers';

/**
 * Provider that echoes the number of non-system messages it sees, then stops.
 * Lets us inspect how many messages the engine passed to the LLM.
 */
function makeInspectingProvider(
    onChat: (messages: LLMMessage[]) => void,
): LLMProvider {
    return {
        async chat(messages, _tools, callbacks) {
            onChat(messages);
            callbacks.onDone({ role: 'assistant', content: 'ok' });
        },
    };
}

function buildEngine(
    provider: LLMProvider,
    maxContextMessages: number,
) {
    const { agents, tools, providers } = buildRegistries(provider);
    const { transport, events } = createMockTransport();
    const engine = new AgentEngine({
        model: { provider: 'mock', id: 'mock' },
        agents, tools, providers,
        defaultProvider: 'mock',
        transport,
        defaultAgentId: 'test-agent',
        maxContextMessages,
    });
    return { engine, events };
}

describe('AgentEngine — context window (trimHistory)', () => {
    it('does not trim when history is within limit', async () => {
        const seen: LLMMessage[][] = [];
        const provider = makeInspectingProvider(msgs => seen.push(msgs));
        const { engine } = buildEngine(provider, 10);

        await engine.run('turn 1');
        await engine.run('turn 2');

        // Each run: 1 system + messages so far. With limit=10 and only 4 msgs, no trim.
        const warnEvents = seen.flat().filter(m =>
            m.role === 'system' && typeof m.content === 'string' && m.content.includes('ContextWindow')
        );
        expect(warnEvents).toHaveLength(0);
    });

    it('trims history when maxContextMessages is exceeded', async () => {
        const messageCounts: number[] = [];
        const provider = makeInspectingProvider(msgs => {
            // Count non-system messages passed to LLM
            messageCounts.push(msgs.filter(m => m.role !== 'system').length);
        });

        // maxContextMessages = 4: keep at most 4 messages before each LLM call
        const { engine } = buildEngine(provider, 4);

        // Each run() adds 1 user + 1 assistant = 2 messages
        await engine.run('turn 1'); // history: [user, asst]      — 2 msgs, no trim
        await engine.run('turn 2'); // history: [user, asst, user, asst] — 4 msgs, at limit
        await engine.run('turn 3'); // history would be 6 → trim to 4

        // By turn 3, the LLM should receive at most 4 non-system messages
        const lastCount = messageCounts[messageCounts.length - 1];
        expect(lastCount).toBeLessThanOrEqual(4);
    });

    it('emits a system warn event when trimming', async () => {
        const provider = makeInspectingProvider(() => undefined);
        const { engine, events } = buildEngine(provider, 2);

        // Run 3 turns; by turn 3, history (user+asst+user+asst = 4) exceeds limit 2
        await engine.run('turn 1');
        await engine.run('turn 2');
        await engine.run('turn 3');

        const warnEvents = events.filter(
            e => e.type === 'system' && (e as { level: string }).level === 'warn'
                && (e as { text: string }).text.includes('ContextWindow'),
        );
        expect(warnEvents.length).toBeGreaterThan(0);
    });

    it('always cuts at a user-turn boundary', async () => {
        // Build a conversation with a tool call in the middle, then trim.
        // The trim must not cut between an assistant tool_call and its tool result.
        const callCount = { n: 0 };
        const provider: LLMProvider = {
            async chat(messages, _tools, callbacks) {
                callCount.n++;
                if (callCount.n === 1) {
                    // First call: return a tool call
                    callbacks.onToolCall?.('noop', '{}', 'id1');
                    callbacks.onDone({
                        role: 'assistant', content: null,
                        tool_calls: [{ id: 'id1', type: 'function', function: { name: 'noop', arguments: '{}' } }],
                    });
                } else {
                    // Subsequent calls: plain text
                    callbacks.onDone({ role: 'assistant', content: 'done' });
                }
            },
        };

        const { agents, tools, providers } = buildRegistries(provider);
        const { transport } = createMockTransport();
        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock',
            transport,
            defaultAgentId: 'test-agent',
            maxContextMessages: 2, // very tight limit to force trimming
        });

        // Should not throw — if trimming orphaned a tool result, the LLM would reject it
        await expect(engine.run('do work')).resolves.toBeUndefined();
        await expect(engine.run('follow up')).resolves.toBeUndefined();
    });
});

describe('AgentEngine — default history cap', () => {
    function build(extra: { maxContextMessages?: number } = {}) {
        let lastSeen = 0;
        const provider = makeInspectingProvider(msgs => { lastSeen = msgs.filter(m => m.role !== 'system').length; });
        const { agents, tools, providers } = buildRegistries(provider);
        const { transport, events } = createMockTransport();
        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' }, agents, tools, providers,
            defaultProvider: 'mock', transport, defaultAgentId: 'test-agent', ...extra,
        });
        return { engine, events, seen: () => lastSeen };
    }

    it('caps the history at 200 messages when nothing is configured, and says so', async () => {
        const { engine, events, seen } = build();
        for (let i = 0; i < 150; i++) await engine.run(`turn ${i}`); // 300 messages without a cap
        expect(seen()).toBeLessThanOrEqual(201);
        expect(events.some(e => e.type === 'system' && JSON.stringify(e).includes('history capped at 200'))).toBe(true);
    });

    it('maxContextMessages: 0 turns the cap off', async () => {
        const { engine, seen } = build({ maxContextMessages: 0 });
        for (let i = 0; i < 150; i++) await engine.run(`turn ${i}`);
        expect(seen()).toBeGreaterThan(250);
    });
});
