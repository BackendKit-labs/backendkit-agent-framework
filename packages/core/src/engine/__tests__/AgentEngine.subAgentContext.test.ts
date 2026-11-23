import { AgentEngine } from '../AgentEngine';
import { defineTool, z } from '../../tools/defineTool';
import type { AgentProfile, LLMMessage, LLMProvider } from '../../types';
import { buildRegistries, createMockTransport, testAgent } from '../../__tests__/helpers';

const BULK = 'z'.repeat(3000);

/** Orchestrator delegates once to `worker`; `workerProvider` is the sub-agent's model. */
function build(workerProvider: LLMProvider, context?: ConstructorParameters<typeof AgentEngine>[0]['context']) {
    let asked = false;
    const orchestrator: LLMProvider = {
        async chat(_m, _t, cb) {
            if (!asked) {
                asked = true;
                const args = JSON.stringify({ agent_id: 'worker', question: 'do the long job' });
                cb.onToolCall?.('ask_agent', args, 'c1');
                cb.onDone({ role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'ask_agent', arguments: args } }] });
            } else {
                cb.onChunk?.('finished');
                cb.onDone({ role: 'assistant', content: 'finished' });
            }
        },
    };
    const parent: AgentProfile = { ...testAgent, delegatesTo: ['worker'] };
    const { agents, tools, providers } = buildRegistries(orchestrator, parent);
    tools.register(defineTool({ name: 'bulk', description: 'big output', input: z.object({}), execute: async () => BULK }));
    agents.upsert({ id: 'worker', name: 'worker', icon: '⚙', description: 'w', systemPrompt: 'work', allowedTools: ['bulk'], delegatesTo: [], provider: 'worker' });
    providers.register('worker', workerProvider);
    const { transport, events } = createMockTransport();
    const engine = new AgentEngine({ requireAgentIdentity: false,
        model: { provider: 'mock', id: 'mock' }, agents, tools, providers, defaultProvider: 'mock', transport,
        defaultAgentId: testAgent.id, iterationMode: 'auto', maxIterations: 30,
        ...(context ? { context } : {}),
    });
    return { engine, events };
}

/** A worker that calls `bulk` `rounds` times, then answers; records the tool results it was shown each call. */
function toolLoopWorker(rounds: number) {
    const seen: string[][] = [];
    let call = 0;
    const provider: LLMProvider = {
        async chat(messages: LLMMessage[], _t, cb) {
            seen.push(messages.filter(m => m.role === 'tool').map(m => m.content ?? ''));
            if (call++ < rounds) {
                const id = `w${call}`;
                cb.onToolCall?.('bulk', '{}', id);
                cb.onDone({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'bulk', arguments: '{}' } }] });
            } else {
                cb.onChunk?.('worker done');
                cb.onDone({ role: 'assistant', content: 'worker done' });
            }
        },
    };
    return { provider, seen };
}

describe('AgentEngine — sub-agent context', () => {
    it('without `context` a sub-agent keeps every tool result whole (unchanged)', async () => {
        const { provider, seen } = toolLoopWorker(8);
        const { engine } = build(provider);
        await engine.run('go');
        const last = seen[seen.length - 1];
        expect(last).toHaveLength(8);
        expect(last.every(r => r.length === BULK.length)).toBe(true);
    });

    it('with `context` a long tool loop is compacted: old bulky results are cut, the newest stay whole', async () => {
        const { provider, seen } = toolLoopWorker(12);
        const { engine, events } = build(provider, { maxTokens: 4000, toolResultMaxChars: 300, strategy: 'drop' });
        await engine.run('go');

        const last = seen[seen.length - 1];
        expect(last).toHaveLength(12);
        const cut = last.filter(r => r.length < BULK.length);
        const whole = last.filter(r => r.length === BULK.length);
        expect(cut.length).toBeGreaterThan(0);
        expect(whole.length).toBeGreaterThanOrEqual(1);
        expect(last.slice(-4).every(r => r.length === BULK.length)).toBe(true); // newest 4 protected
        expect(events.some(e => e.type === 'error')).toBe(false);
    });

    it('recovers once from a provider "context too long" error: compacts hard and retries', async () => {
        const seen: string[][] = [];
        let call = 0;
        let overflowed = false;
        const provider: LLMProvider = {
            async chat(messages, _t, cb) {
                seen.push(messages.filter(m => m.role === 'tool').map(m => m.content ?? ''));
                if (call++ < 6) {
                    const id = `w${call}`;
                    cb.onToolCall?.('bulk', '{}', id);
                    cb.onDone({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'bulk', arguments: '{}' } }] });
                } else if (!overflowed) {
                    overflowed = true;
                    cb.onError(new Error("This model's maximum context length is 8192 tokens"));
                } else {
                    cb.onChunk?.('recovered');
                    cb.onDone({ role: 'assistant', content: 'recovered' });
                }
            },
        };
        const { engine, events } = build(provider, { maxTokens: 1_000_000, toolResultMaxChars: 300, strategy: 'drop' }); // threshold never reached on its own
        await engine.run('go');

        expect(overflowed).toBe(true);
        const retried = seen[seen.length - 1];
        expect(retried.some(r => r.length < BULK.length)).toBe(true);   // the forced compaction cut something
        expect(events.some(e => e.type === 'error')).toBe(false);
        expect(events.filter(e => e.type === 'done')).toHaveLength(1);
    });

    it('does not retry an unrelated provider error', async () => {
        let calls = 0;
        const provider: LLMProvider = {
            async chat(_m, _t, cb) { calls++; cb.onError(new Error('rate limited')); },
        };
        const { engine, events } = build(provider, { maxTokens: 1000, strategy: 'drop' });
        await engine.run('go');
        expect(calls).toBe(1);
        expect(events.some(e => e.type === 'tool_result' && (e as { success?: boolean }).success === false)).toBe(true);
    });
});
