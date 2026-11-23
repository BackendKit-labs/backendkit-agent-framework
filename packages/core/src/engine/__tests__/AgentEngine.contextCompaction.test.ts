import { AgentEngine } from '../AgentEngine';
import { extractSummary } from '../ContextManager';
import type { LLMMessage, LLMProvider } from '../../types';
import { buildRegistries, createMockTransport } from '../../__tests__/helpers';

const turnText = (i: number) => `turn ${i}: ` + 'lorem ipsum '.repeat(40);

function build(opts: { summarizer?: LLMProvider; mainSeen: LLMMessage[][]; failSummary?: boolean }) {
    const main: LLMProvider = {
        async chat(messages, _tools, callbacks) {
            opts.mainSeen.push(messages.filter(m => m.role !== 'system'));
            callbacks.onMetrics?.(1000, 20);
            callbacks.onDone({ role: 'assistant', content: 'ok ' + 'reply '.repeat(30) });
        },
    };
    const { agents, tools, providers } = buildRegistries(main);
    if (opts.summarizer) providers.register('cheap', opts.summarizer);
    const { transport, events } = createMockTransport();
    const engine = new AgentEngine({ requireAgentIdentity: false,
        model: { provider: 'mock', id: 'mock' },
        agents, tools, providers,
        defaultProvider: 'mock',
        transport,
        defaultAgentId: 'test-agent',
        context: { maxTokens: 700, keepRecentTurns: 2, summarizer: { provider: 'cheap', model: 'tiny-model' } },
    });
    return { engine, events };
}

describe('AgentEngine — token-aware context compaction', () => {
    it('summarizes old turns with the configured provider and model, and keeps the agent running', async () => {
        const mainSeen: LLMMessage[][] = [];
        const summarizerCalls: Array<{ model?: string; prompt: string }> = [];
        const summarizer: LLMProvider = {
            async chat(messages, _tools, callbacks) {
                summarizerCalls.push({ model: callbacks.model, prompt: String(messages[messages.length - 1].content) });
                callbacks.onMetrics?.(300, 40);
                callbacks.onDone({ role: 'assistant', content: '- user asked 12 questions' });
            },
        };
        const { engine, events } = build({ summarizer, mainSeen });

        for (let i = 0; i < 12; i++) await engine.run(turnText(i));

        expect(summarizerCalls.length).toBeGreaterThan(0);
        expect(summarizerCalls.every(c => c.model === 'tiny-model')).toBe(true);
        const last = mainSeen[mainSeen.length - 1];
        expect(last.length).toBeLessThan(24);                         // not the whole 12-turn history
        expect(last.some(m => extractSummary(m) !== undefined)).toBe(true);
        expect(last[last.length - 1].role).toBe('user');
        expect(last.some(m => m.content?.includes(turnText(11)))).toBe(true);   // newest turn intact
        expect(events.filter(e => e.type === 'compacting' && e.phase === 'done').length).toBeGreaterThan(0);
        // Summarizer usage is reported like any other call (so cost tracking sees it).
        expect(events.filter(e => e.type === 'metrics' && e.input_tokens === 300).length).toBe(summarizerCalls.length);
        expect(events.some(e => e.type === 'error')).toBe(false);
    });

    it('survives a failing summarizer by dropping old messages', async () => {
        const mainSeen: LLMMessage[][] = [];
        const summarizer: LLMProvider = {
            async chat(_m, _t, callbacks) { callbacks.onError(new Error('summarizer down')); },
        };
        const { engine, events } = build({ summarizer, mainSeen });

        for (let i = 0; i < 12; i++) await engine.run(turnText(i));

        expect(events.filter(e => e.type === 'done')).toHaveLength(12);
        expect(events.some(e => e.type === 'compacting' && e.phase === 'fail')).toBe(true);
        expect(events.some(e => e.type === 'system' && e.level === 'warn' && e.text.includes('Summarizer failed'))).toBe(true);
        const last = mainSeen[mainSeen.length - 1];
        expect(last.length).toBeLessThan(24);
        expect(last.some(m => extractSummary(m) !== undefined)).toBe(false);
    });

    it('does not touch the history when context is not configured', async () => {
        const seen: LLMMessage[][] = [];
        const main: LLMProvider = {
            async chat(messages, _t, callbacks) { seen.push(messages); callbacks.onDone({ role: 'assistant', content: 'ok' }); },
        };
        const { agents, tools, providers } = buildRegistries(main);
        const { transport } = createMockTransport();
        const engine = new AgentEngine({ requireAgentIdentity: false,
            model: { provider: 'mock', id: 'mock' }, agents, tools, providers,
            defaultProvider: 'mock', transport, defaultAgentId: 'test-agent',
        });
        for (let i = 0; i < 6; i++) await engine.run(turnText(i));
        expect(seen[seen.length - 1].filter(m => m.role !== 'system')).toHaveLength(11);
    });
});
