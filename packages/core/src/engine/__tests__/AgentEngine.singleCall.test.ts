import { AgentEngine } from '../AgentEngine';
import type { AgentEvent, AgentProfile, LLMProvider } from '../../types';
import { buildRegistries, createMockTransport, createScriptedProvider, testAgent } from '../../__tests__/helpers';

/** Answers "ok" and reports 10 in / 5 out. */
const metered: LLMProvider = {
    async chat(_m, _t, cb) {
        cb.onChunk?.('ok');
        cb.onMetrics?.(10, 5);
        cb.onDone({ role: 'assistant', content: 'ok' });
    },
};

function engineWith(provider: LLMProvider, agent: AgentProfile = testAgent) {
    const { agents, tools, providers } = buildRegistries(provider, agent);
    const { transport, events } = createMockTransport();
    const engine = new AgentEngine({
        requireAgentIdentity: false,
        model: { provider: 'mock', id: 'mock' }, agents, tools, providers,
        defaultProvider: 'mock', transport, defaultAgentId: agent.id, iterationMode: 'auto', maxIterations: 5,
    });
    return { engine, events, tools, agents, providers };
}

const metrics = (events: AgentEvent[], purpose: string) =>
    events.filter(e => e.type === 'metrics' && (e as { purpose?: string }).purpose === purpose);

describe('AgentEngine — LLM calls outside the conversation are counted', () => {
    it('callLLM reports its tokens as a metrics event', async () => {
        const { engine, events } = engineWith(metered);
        expect(await engine.callLLM('hi')).toBe('ok');
        expect(metrics(events, 'call_llm')).toEqual([expect.objectContaining({ input_tokens: 10, output_tokens: 5 })]);
    });

    it('callLLM rejects when the provider rejects instead of calling onError (it used to hang)', async () => {
        const { engine } = engineWith({ chat: async () => { throw new Error('provider down'); } });
        await expect(engine.callLLM('hi')).rejects.toThrow('provider down');
    });

    it('ctx.llmCall reports its tokens, for the agent that runs the tool', async () => {
        let answer = '';
        const main: AgentProfile = { ...testAgent, allowedTools: ['think'] };
        const script = createScriptedProvider([{ tool_calls: [{ id: 't', name: 'think', args: {} }] }, { content: 'done' }]);
        let calls = 0;
        // The first two calls are the conversation; the one in between is the tool's llmCall.
        const provider: LLMProvider = { chat: (m, t, cb, o) => (calls++ === 1 ? metered.chat(m, t, cb, o) : script.chat(m, t, cb, o)) };
        const { engine, events, tools } = engineWith(provider, main);
        tools.register({ name: 'think', description: '', parameters: { type: 'object' }, readOnly: true, execute: async (_a, ctx) => { answer = await ctx.llmCall!('q'); return answer; } });
        await engine.run('go');
        expect(answer).toBe('ok');
        expect(metrics(events, 'tool_llm_call')).toEqual([expect.objectContaining({ input_tokens: 10, output_tokens: 5, agent_id: main.id })]);
    });

    it('ctx.llmCall fails with the provider error instead of returning ""', async () => {
        const main: AgentProfile = { ...testAgent, allowedTools: ['think'] };
        const script = createScriptedProvider([{ tool_calls: [{ id: 't', name: 'think', args: {} }] }, { content: 'done' }]);
        let calls = 0;
        const provider: LLMProvider = {
            chat: (m, t, cb, o) => {
                if (calls++ === 1) { cb.onError(new Error('provider down')); return Promise.resolve(); }
                return script.chat(m, t, cb, o);
            },
        };
        const { engine, events, tools } = engineWith(provider, main);
        tools.register({ name: 'think', description: '', parameters: { type: 'object' }, readOnly: true, execute: async (_a, ctx) => ctx.llmCall!('q') });
        await engine.run('go');
        const result = events.find(e => e.type === 'tool_result' && e.name === 'think') as { success: boolean; preview: string };
        expect(result.success).toBe(false);
        expect(result.preview).toContain('provider down');
    });
});

describe('AgentEngine — a delegation without policies still needs an identity', () => {
    it('refuses ask_agent when the agent has no identity, and never runs the delegate', async () => {
        const ran: string[] = [];
        const main: AgentProfile = { ...testAgent, delegatesTo: ['helper'] };
        const { agents, tools, providers } = buildRegistries(createScriptedProvider([
            { tool_calls: [{ id: 'c1', name: 'ask_agent', args: { agent_id: 'helper', question: 'q' } }] },
            { content: 'done' },
        ]), main);
        agents.upsert({ ...testAgent, id: 'helper', name: 'helper', allowedTools: [], delegatesTo: [], provider: 'helper' });
        providers.register('helper', { chat: async (_m, _t, cb) => { ran.push('helper'); cb.onDone({ role: 'assistant', content: 'hi' }); } });
        const { transport, events } = createMockTransport();
        // No policy, no approver: the ungoverned path. Identity is required (the default) and none is configured.
        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' }, agents, tools, providers,
            defaultProvider: 'mock', transport, defaultAgentId: main.id, iterationMode: 'auto', maxIterations: 5,
        });
        await engine.run('go');
        expect(ran).toEqual([]);
        const result = events.find(e => e.type === 'tool_result' && e.name === 'ask_agent') as { success: boolean; preview: string };
        expect(result.success).toBe(false);
        expect(result.preview).toContain('no digital identity');
    });
});
