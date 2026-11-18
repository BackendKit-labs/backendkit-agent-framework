/**
 * What `engine.run` returns, the opt-in system prompt event, the code of an error in `tool_result` and the budget state
 * (found useful while building the trading bench: the callers had to rebuild all of it from the events).
 */
import { createBaseEngine, type BaseEngineOptions } from '../createBaseEngine';
import { ToolError } from '../../tools/tool-error';
import type { AgentProfile, LLMProvider, ToolDefinition } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent, type Turn } from '../../__tests__/helpers';

const agent: AgentProfile = { ...testAgent, id: 'main', allowedTools: ['ok', 'coded', 'plain'], delegatesTo: ['helper'] };
const helper: AgentProfile = { ...testAgent, id: 'helper', name: 'Helper', allowedTools: ['ok'], delegatesTo: [] };

const tools: ToolDefinition[] = [
    { name: 'ok', description: '', parameters: { type: 'object' }, execute: async () => 'fine' },
    { name: 'coded', description: '', parameters: { type: 'object' }, execute: async () => { throw new ToolError('RISK_MAX_POSITION', 'too big'); } },
    { name: 'plain', description: '', parameters: { type: 'object' }, execute: async () => { throw new Error('boom'); } },
];

const call = (...names: string[]): Turn => ({ tool_calls: names.map((name, i) => ({ id: `c${i}-${name}`, name, args: {} })) });

function build(script: Turn[], extra: Partial<BaseEngineOptions> = {}, provider?: LLMProvider) {
    const { transport, events } = createMockTransport();
    const engine = createBaseEngine({
        providers: { mock: provider ?? createScriptedProvider(script) }, defaultProvider: 'mock', agents: [agent, helper], defaultAgent: agent.id,
        tools, transport, workingDir: process.cwd(), iterationMode: 'auto', ...extra,
    });
    return { engine, events };
}

describe('engine.run returns what happened', () => {
    it('the tool calls in order, with the code of a failed one, and the text after the last call', async () => {
        const { engine } = build([call('ok', 'coded', 'plain'), { content: 'All done.' }]);
        const r = await engine.run('go');
        expect(r.toolCalls.map(t => [t.name, t.success, t.errorCode])).toEqual([['ok', true, undefined], ['coded', false, 'RISK_MAX_POSITION'], ['plain', false, undefined]]);
        expect(r.toolCalls[0].agentId).toBe('main');
        expect(r.text).toBe('All done.');
        expect(r).toMatchObject({ aborted: false, budgetExceeded: false, errors: [], systemPrompts: [] });
    });

    it('text is only what the agent said at the end, not what it said between calls', async () => {
        const { engine } = build([{ content: 'thinking', tool_calls: [{ id: '1', name: 'ok', args: {} }] } as Turn, { content: 'Final.' }]);
        expect((await engine.run('go')).text).toBe('Final.');
    });

    it('every run gets its own result', async () => {
        const { engine } = build([call('ok'), { content: 'one' }, { content: 'two' }]);
        const a = await engine.run('a');
        const b = await engine.run('b');
        expect(a.toolCalls).toHaveLength(1);
        expect(b.toolCalls).toHaveLength(0);
        expect(b.text).toBe('two');
    });

    it('a turn that ends early still returns its result: blocked input is an error, not a crash', async () => {
        const { engine } = build([{ content: 'unreachable' }]);
        const r = await engine.run('x'.repeat(200_000));
        expect(r.errors[0]).toMatch(/Input too large/);
        expect(r.toolCalls).toEqual([]);
    });

    it('the tool calls of a delegate belong to the turn that asked for it', async () => {
        const { engine } = build([
            { tool_calls: [{ id: 'd1', name: 'ask_agent', args: { agent_id: 'helper', question: 'help' } }] },
            call('ok'),                // the helper's turn
            { content: 'helped' },     // the helper answers
            { content: 'Done.' },      // the agent answers
        ]);
        const r = await engine.run('delegate');
        const names = r.toolCalls.map(t => `${t.agentId}:${t.name}`);
        expect(names).toContain('helper:ok');
        expect(names).toContain('main:ask_agent');
        expect(r.text).toBe('Done.');
    });

    it('the error code reaches the tool_result event as error_code', async () => {
        const { engine, events } = build([call('coded'), { content: 'x' }]);
        await engine.run('go');
        const e = events.find(x => x.type === 'tool_result') as { error_code?: string };
        expect(e.error_code).toBe('RISK_MAX_POSITION');
    });
});

describe('emitSystemPrompt', () => {
    it('is off by default: no prompt reaches a transport', async () => {
        const { engine, events } = build([{ content: 'x' }]);
        const r = await engine.run('go');
        expect(events.some(e => e.type === 'system_prompt')).toBe(false);
        expect(r.systemPrompts).toEqual([]);
    });

    it('when on, every model call announces the system prompt it sends, and the result keeps them', async () => {
        const { engine, events } = build([call('ok'), { content: 'x' }], { emitSystemPrompt: true });
        const r = await engine.run('go');
        const prompts = events.filter(e => e.type === 'system_prompt') as Array<{ agent_id: string; text: string }>;
        expect(prompts).toHaveLength(2);
        expect(prompts[0]).toMatchObject({ agent_id: 'main' });
        expect(prompts[0].text).toContain(testAgent.systemPrompt);
        expect(r.systemPrompts).toEqual(prompts.map(p => p.text));
    });
});

describe('the budget', () => {
    const pricing = { inputPricePerMToken: 3, outputPricePerMToken: 15 };
    const spending = (): LLMProvider => {
        let n = 0;
        return { async chat(_m, _t, cb) {
            const id = `c${++n}`;
            cb.onToolCall?.('ok', '{}', id);
            cb.onMetrics?.(1_000_000, 0);
            cb.onDone({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'ok', arguments: '{}' } }] });
        } };
    };

    it('with abortOnBudget, the run says so, is aborted, and the engine remembers it', async () => {
        const { engine } = build([], { abortOnBudget: true, maxIterations: 5, observability: { costTracker: { ...pricing, budget: { perRun: 0.01 } } } }, spending());
        expect(engine.budgetExceeded).toBe(false);
        const r = await engine.run('go');
        expect(r.budgetExceeded).toBe(true);
        expect(r.aborted).toBe(true);
        expect(engine.budgetExceeded).toBe(true);
    });

    it('without abortOnBudget the run is not stopped, but it still reports the budget (and sends no event, as always)', async () => {
        const { engine, events } = build([], { maxIterations: 3, observability: { costTracker: { ...pricing, budget: { perRun: 0.01 } } } }, spending());
        const r = await engine.run('go');
        expect(r.budgetExceeded).toBe(true);
        expect(r.aborted).toBe(false);
        expect(engine.budgetExceeded).toBe(true);
        expect(events.some(e => e.type === 'budget_exceeded')).toBe(false);
    });

    it('without a budget nothing is reported', async () => {
        const { engine } = build([{ content: 'x' }]);
        expect((await engine.run('go')).budgetExceeded).toBe(false);
        expect(engine.budgetExceeded).toBe(false);
    });
});

describe('recordArgs: the arguments of each call in the result (SPEC-0021 D7)', () => {
    const withArgs = (): Turn => ({ tool_calls: [{ id: 'c1', name: 'ok', args: { symbol: 'AAPL', sizePct: 12 } }, { id: 'c2', name: 'coded', args: { n: 1 } }] });

    it('with the option, each call carries what the model passed, failed calls included', async () => {
        const { engine } = build([withArgs(), { content: 'done' }], { recordArgs: true });
        const r = await engine.run('go');
        expect(r.toolCalls.map(t => [t.name, t.args])).toEqual([['ok', { symbol: 'AAPL', sizePct: 12 }], ['coded', { n: 1 }]]);
    });

    it('the arguments reach the result only: no event, so no transport, carries them', async () => {
        const { engine, events } = build([withArgs(), { content: 'done' }], { recordArgs: true });
        const r = await engine.run('go');
        expect(r.toolCalls[0].args).toEqual({ symbol: 'AAPL', sizePct: 12 });
        expect(events.filter(e => e.type === 'tool_result')).toHaveLength(2);
        // The event of the result carries no arguments. (The older tool_call event shows the first 200 characters of them as args_preview, with or without the option.)
        expect(JSON.stringify(events.filter(e => e.type === 'tool_result'))).not.toContain('AAPL');
        expect(events.filter(e => e.type === 'tool_result').every(e => !('args' in e))).toBe(true);
    });

    it('calls of a parallel wave and of a delegate keep their own arguments', async () => {
        const par: Turn = { tool_calls: [{ id: 'p1', name: 'ok', args: { n: 1 } }, { id: 'p2', name: 'ok', args: { n: 2 } }] };
        const { engine } = build([par, { content: 'done' }], { recordArgs: true, maxParallelTools: 2 });
        const r = await engine.run('go');
        expect(r.toolCalls.map(t => t.args)).toEqual([{ n: 1 }, { n: 2 }]);
        const del: Turn = { tool_calls: [{ id: 'd1', name: 'ask_agent', args: { agent_id: 'helper', question: 'q' } }] };
        const d = build([del, { tool_calls: [{ id: 'h1', name: 'ok', args: { from: 'helper' } }] }, { content: 'helper says' }, { content: 'done' }], { recordArgs: true });
        const rd = await d.engine.run('go');
        expect(rd.toolCalls.find(t => t.name === 'ok')?.args).toEqual({ from: 'helper' });
    });

    it('without it, the result has no args: they can be sensitive, and the audit log keeps only their hash', async () => {
        const { engine, events } = build([withArgs(), { content: 'done' }]);
        const r = await engine.run('go');
        expect(r.toolCalls.every(t => !('args' in t))).toBe(true);
        expect(events.filter(e => e.type === 'tool_result').every(e => !('args' in e))).toBe(true);
    });
});
