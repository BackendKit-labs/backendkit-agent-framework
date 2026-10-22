import { createBaseEngine } from '../../engine/createBaseEngine';
import { defineTool, z } from '../../tools/defineTool';
import type { AgentProfile, LLMProvider } from '../../types';
import type { Span } from '../types';
import { createMockTransport } from '../../__tests__/helpers';

const agent: AgentProfile = {
    id: 'main', name: 'Main', icon: 'M', description: 'x', systemPrompt: 'x',
    allowedTools: ['slow_a', 'slow_b'], delegatesTo: [], model: 'tiny-model',
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function tool(name: string, ms: number, ok = true) {
    return defineTool({
        name, description: name, input: z.object({}), concurrencySafe: true,
        execute: async () => { await sleep(ms); if (!ok) throw new Error('nope'); return `${name} done`; },
    });
}

function provider(): LLMProvider {
    let turn = 0;
    return {
        modelId: 'provider-default-model',
        async chat(_m, _t, cb) {
            await sleep(15);
            if (turn++ === 0) {
                const calls = [
                    { id: 'a', name: 'slow_a' }, { id: 'b', name: 'slow_b' },
                ];
                for (const c of calls) cb.onToolCall?.(c.name, '{}', c.id);
                cb.onMetrics?.(100, 10);
                cb.onDone({ role: 'assistant', content: null, tool_calls: calls.map(c => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: '{}' } })) });
            } else {
                cb.onChunk?.('finished');
                cb.onMetrics?.(150, 20, { cacheReadTokens: 40, cacheWriteTokens: 0 });
                cb.onDone({ role: 'assistant', content: 'finished' });
            }
        },
    };
}

async function runTraced(tools = [tool('slow_a', 60), tool('slow_b', 60)]) {
    const spans: Span[] = [];
    const { transport } = createMockTransport();
    const engine = createBaseEngine({
        providers: { mock: provider() }, defaultProvider: 'mock',
        agents: [agent], tools, transport,
        maxParallelTools: 2, iterationMode: 'auto',
        observability: { tracing: { exporter: (s) => spans.push(s) }, costTracker: { inputPricePerMToken: 10, outputPricePerMToken: 20 } },
    });
    await engine.run('go');
    return spans;
}

describe('ObservabilityManager — llm_call and tool_call spans', () => {
    it('records one llm_call per model call, with tokens, model and cost', async () => {
        const spans = await runTraced();
        const llm = spans.filter(s => s.name === 'llm_call');
        expect(llm).toHaveLength(2);
        expect(llm[0].tags).toMatchObject({ agent_id: 'main', provider: 'mock', model: 'tiny-model', input_tokens: 100, output_tokens: 10 });
        expect(llm[1].tags).toMatchObject({ input_tokens: 150, output_tokens: 20, cache_read_tokens: 40 });
        expect(Number(llm[0].tags.cost_usd)).toBeCloseTo((100 * 10 + 10 * 20) / 1_000_000, 8);
        expect(llm.every(s => s.durationMs >= 10)).toBe(true);
    });

    it('records one tool_call per tool with its real duration, even in a parallel wave', async () => {
        const spans = await runTraced();
        const calls = spans.filter(s => s.name === 'tool_call');
        expect(calls.map(s => s.tags['tool.name']).sort()).toEqual(['slow_a', 'slow_b']);
        for (const c of calls) {
            expect(c.durationMs).toBeGreaterThanOrEqual(50);
            expect(c.durationMs).toBeLessThan(500);
            expect(c.status).toBe('ok');
        }
        // They ran side by side, so their intervals overlap instead of being laid end to end.
        const [x, y] = calls;
        expect(x.startedAt.getTime()).toBeLessThan(y.endedAt.getTime());
        expect(y.startedAt.getTime()).toBeLessThan(x.endedAt.getTime());
    });

    it('nests run → agent_block → llm_call / tool_call under one trace', async () => {
        const spans = await runTraced();
        const run = spans.find(s => s.name === 'run')!;
        const block = spans.find(s => s.name === 'agent_block')!;
        expect(block.parentSpanId).toBe(run.spanId);
        for (const s of spans.filter(s => s.name === 'llm_call' || s.name === 'tool_call')) {
            expect(s.parentSpanId).toBe(block.spanId);
        }
        expect(new Set(spans.map(s => s.traceId)).size).toBe(1);
        // children sit inside the block's interval
        for (const s of spans.filter(s => s.parentSpanId === block.spanId)) {
            expect(s.startedAt.getTime()).toBeGreaterThanOrEqual(block.startedAt.getTime() - 5);
            expect(s.endedAt.getTime()).toBeLessThanOrEqual(block.endedAt.getTime() + 5);
        }
    });

    it('marks a failing tool as error', async () => {
        const spans = await runTraced([tool('slow_a', 5, false), tool('slow_b', 5)]);
        const failed = spans.find(s => s.name === 'tool_call' && s.tags['tool.name'] === 'slow_a')!;
        expect(failed.status).toBe('error');
        expect(failed.tags.success).toBe(false);
    });

    it('labels the model with the provider default when the profile sets none', async () => {
        const spans: Span[] = [];
        const { transport } = createMockTransport();
        const engine = createBaseEngine({
            providers: { mock: provider() }, defaultProvider: 'mock',
            agents: [{ ...agent, model: undefined }], tools: [tool('slow_a', 1), tool('slow_b', 1)], transport,
            observability: { tracing: { exporter: (s) => spans.push(s) } },
        });
        await engine.run('go');
        expect(spans.find(s => s.name === 'llm_call')!.tags.model).toBe('provider-default-model');
    });

    it('does not create call spans without a tracer', async () => {
        const { transport } = createMockTransport();
        const engine = createBaseEngine({
            providers: { mock: provider() }, defaultProvider: 'mock',
            agents: [agent], tools: [tool('slow_a', 1), tool('slow_b', 1)], transport,
            observability: { metrics: {} },
        });
        await expect(engine.run('go')).resolves.toBeUndefined();
    });
});
