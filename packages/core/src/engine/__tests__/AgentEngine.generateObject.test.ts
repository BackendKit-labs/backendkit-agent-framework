import { z } from 'zod';
import { AgentEngine } from '../AgentEngine';
import { StructuredOutputError } from '../../structured/generateObject';
import type { AgentProfile, LLMProvider } from '../../types';
import { buildRegistries, createMockTransport, testAgent } from '../../__tests__/helpers';

/** SPEC-0001 §5 (ADR-0003): engine.generateObject uses the agent's provider and accounts for the cost. */

const schema = z.object({ verdict: z.enum(['ok', 'revise']) });

function build(provider: LLMProvider, extraAgents: AgentProfile[] = []) {
    const { agents, tools, providers } = buildRegistries(provider);
    for (const a of extraAgents) agents.upsert(a);
    const { transport, events } = createMockTransport();
    const engine = new AgentEngine({ requireAgentIdentity: false,
        model: { provider: 'mock', id: 'mock' }, agents, tools, providers,
        defaultProvider: 'mock', transport, defaultAgentId: testAgent.id,
        iterationMode: 'auto', maxIterations: 3,
    });
    return { engine, events, providers };
}

describe('AgentEngine.generateObject', () => {
    it('returns the validated object and emits the token usage as a metrics event', async () => {
        const provider: LLMProvider = {
            async chat(_m, _t, cb) {
                cb.onMetrics?.(40, 6);
                cb.onChunk?.('{"verdict":"ok"}');
                cb.onDone({ role: 'assistant', content: '{"verdict":"ok"}' });
            },
        };
        const { engine, events } = build(provider);
        await expect(engine.generateObject('review it', schema)).resolves.toEqual({ verdict: 'ok' });
        expect(events.filter(e => e.type === 'metrics')).toEqual([expect.objectContaining({ type: 'metrics', input_tokens: 40, output_tokens: 6, purpose: 'structured_output' })]);
    });

    it('uses the provider and model of the requested agent', async () => {
        const seen: Array<{ who: string; model?: string }> = [];
        const make = (who: string): LLMProvider => ({
            async chat(_m, _t, cb) {
                seen.push({ who, model: cb.model });
                cb.onChunk?.('{"verdict":"revise"}');
                cb.onDone({ role: 'assistant', content: null });
            },
        });
        const other: AgentProfile = { ...testAgent, id: 'judge', provider: 'judge', model: 'judge-model' };
        const { engine, providers } = build(make('default'), [other]);
        providers.register('judge', make('judge'));
        await engine.generateObject('p', schema, { agentId: 'judge' });
        expect(seen).toEqual([{ who: 'judge', model: 'judge-model' }]);
    });

    it('is not a run: no conversation events, and the prompt is sent alone', async () => {
        const sent: number[] = [];
        const provider: LLMProvider = {
            async chat(messages, _t, cb) {
                sent.push(messages.length);
                cb.onChunk?.('{"verdict":"ok"}');
                cb.onDone({ role: 'assistant', content: null });
            },
        };
        const { engine, events } = build(provider);
        await engine.generateObject('p', schema);
        expect(events.map(e => e.type)).not.toContain('ready');
        expect(events.map(e => e.type)).not.toContain('token');
        expect(sent).toEqual([1]);
    });

    it('throws StructuredOutputError when the model never complies', async () => {
        const provider: LLMProvider = {
            async chat(_m, _t, cb) { cb.onChunk?.('{"verdict":"maybe"}'); cb.onDone({ role: 'assistant', content: null }); },
        };
        const { engine } = build(provider);
        await expect(engine.generateObject('p', schema)).rejects.toBeInstanceOf(StructuredOutputError);
    });

    it('rejects an unknown agent', async () => {
        const { engine } = build({ async chat(_m, _t, cb) { cb.onDone({ role: 'assistant', content: '{}' }); } });
        await expect(engine.generateObject('p', schema, { agentId: 'ghost' })).rejects.toThrow('Agent "ghost" not registered');
    });
});
