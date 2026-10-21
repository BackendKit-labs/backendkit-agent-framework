import { AgentEngine } from '../AgentEngine';
import { HistoryManager } from '../HistoryManager';
import { createBaseEngine } from '../createBaseEngine';
import type { LLMMessage, LLMProvider } from '../../types';
import { buildRegistries, createMockTransport, testAgent } from '../../__tests__/helpers';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/** SPEC-0001 §6 (ADR-0004): cache usage reaches the metrics event; `raw` survives the history. */

function providerWithUsage(usage?: { cacheReadTokens?: number; cacheWriteTokens?: number }): LLMProvider {
    return {
        async chat(_m, _t, cb) {
            cb.onMetrics?.(10, 5, usage);
            cb.onChunk?.('ok');
            cb.onDone({ role: 'assistant', content: 'ok' });
        },
    };
}

function build(provider: LLMProvider) {
    const { agents, tools, providers } = buildRegistries(provider);
    const { transport, events } = createMockTransport();
    const engine = new AgentEngine({
        model: { provider: 'mock', id: 'mock' }, agents, tools, providers,
        defaultProvider: 'mock', transport, defaultAgentId: testAgent.id,
        iterationMode: 'auto', maxIterations: 3,
    });
    return { engine, events };
}

describe('metrics event with cache usage', () => {
    it('carries cache_read_tokens and cache_write_tokens when the provider reports them', async () => {
        const { engine, events } = build(providerWithUsage({ cacheReadTokens: 100, cacheWriteTokens: 7 }));
        await engine.run('hi');
        expect(events.find(e => e.type === 'metrics')).toEqual({
            type: 'metrics', input_tokens: 10, output_tokens: 5, cache_read_tokens: 100, cache_write_tokens: 7,
        });
    });

    it('omits the cache fields when there is no usage detail', async () => {
        const { engine, events } = build(providerWithUsage());
        await engine.run('hi');
        expect(events.find(e => e.type === 'metrics')).toEqual({ type: 'metrics', input_tokens: 10, output_tokens: 5 });
    });

    it('feeds cache tokens into the cost tracker through createBaseEngine', async () => {
        const { transport } = createMockTransport();
        let runCost = -1;
        const engine = createBaseEngine({
            providers: { mock: providerWithUsage({ cacheReadTokens: 1_000_000 }) },
            defaultProvider: 'mock', agents: [testAgent], defaultAgent: testAgent.id, tools: [], transport,
            workingDir: process.cwd(), noQA: true, iterationMode: 'auto',
            observability: { costTracker: { inputPricePerMToken: 10, cacheReadPricePerMToken: 1, budget: { perRun: 0.5 }, onBudgetExceeded: u => { runCost = u.runCostUsd; } } },
        });
        await engine.run('hi');
        // 1M cache-read tokens x 1 USD/M + 10 input tokens x 10 USD/M
        expect(runCost).toBeCloseTo(1.0001, 6);
    });
});

describe('LLMMessage.raw in the history', () => {
    const assistant: LLMMessage = {
        role: 'assistant', content: 'answer',
        tool_calls: [{ id: 't1', type: 'function', function: { name: 'f', arguments: '{}' } }],
        raw: [{ type: 'thinking', thinking: 'hmm', signature: 'sig' }, { type: 'tool_use', id: 't1', name: 'f', input: {} }],
    };
    const history = (): LLMMessage[] => [
        { role: 'user', content: 'q' }, assistant, { role: 'tool', tool_call_id: 't1', content: 'r' },
    ];

    it('sanitized() keeps raw on complete chains', () => {
        const h = new HistoryManager({});
        h.pushAll(history());
        expect(h.sanitized()[1].raw).toEqual(assistant.raw);
    });

    it('is persisted to disk and restored', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hist-'));
        const file = join(dir, 'history.json');
        try {
            const a = new HistoryManager({ historyPath: file });
            a.pushAll(history());
            a.save();
            expect(JSON.parse(readFileSync(file, 'utf-8'))[1].raw).toEqual(assistant.raw);
            expect(new HistoryManager({ historyPath: file }).getAll()[1].raw).toEqual(assistant.raw);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
});
