import { AgentEngine } from '../AgentEngine';
import type { ToolDefinition, LLMMessage, LLMProvider } from '../../types';
import { buildRegistries, createMockTransport, testAgent } from '../../__tests__/helpers';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function tool(name: string, ms: number, safe: boolean, log: string[] = []): ToolDefinition {
    return {
        name, description: name, parameters: { type: 'object', properties: {} },
        ...(safe ? { concurrencySafe: true } : {}),
        execute: async () => { await sleep(ms); log.push(name); return `out-${name}`; },
    };
}

function run(names: string[], tools: ToolDefinition[], opts: Record<string, unknown> = {}, agentTools = names) {
    let seen: LLMMessage[] = [];
    let n = 0;
    const provider: LLMProvider = {
        async chat(messages, _t, cb) {
            if (n++ === 0) {
                const calls = names.map((nm, i) => ({ id: `c${i}`, type: 'function' as const, function: { name: nm, arguments: '{}' } }));
                calls.forEach(c => cb.onToolCall?.(c.function.name, '{}', c.id));
                cb.onDone({ role: 'assistant', content: null, tool_calls: calls });
            } else { seen = messages; cb.onChunk?.('done'); cb.onDone({ role: 'assistant', content: 'done' }); }
        },
    };
    const { agents, tools: reg, providers } = buildRegistries(provider, { ...testAgent, allowedTools: agentTools });
    tools.forEach(t => reg.register(t));
    const { transport, events } = createMockTransport();
    const engine = new AgentEngine({
        model: { provider: 'mock', id: 'mock' }, agents, tools: reg, providers,
        defaultProvider: 'mock', transport, defaultAgentId: testAgent.id,
        iterationMode: 'auto', maxIterations: 10, ...opts,
    });
    return { engine, events, results: () => seen.filter(m => m.role === 'tool') };
}

describe('parallel tool calls (ADR-0001)', () => {
    const three = () => [tool('a', 200, true), tool('b', 200, true), tool('c', 200, true)];

    it('runs safe tools concurrently with maxParallelTools: 3', async () => {
        const { engine } = run(['a', 'b', 'c'], three(), { maxParallelTools: 3 });
        const t = Date.now();
        await engine.run('go');
        expect(Date.now() - t).toBeLessThan(550);
    });

    it('stays sequential by default', async () => {
        const { engine } = run(['a', 'b', 'c'], three());
        const t = Date.now();
        await engine.run('go');
        expect(Date.now() - t).toBeGreaterThanOrEqual(590);
    });

    it('keeps result order = call order even if they finish reversed', async () => {
        const { engine, results, events } = run(['slow', 'fast'], [tool('slow', 150, true), tool('fast', 10, true)], { maxParallelTools: 2 });
        await engine.run('go');
        expect(results().map(m => m.tool_call_id)).toEqual(['c0', 'c1']);
        const names = events.filter(e => e.type === 'tool_result').map(e => (e as { name: string }).name);
        expect(names).toEqual(['slow', 'fast']);
    });

    it('a non-safe tool is a barrier between waves', async () => {
        const log: string[] = [];
        const { engine } = run(['a', 'w', 'b'], [tool('a', 50, true, log), tool('w', 10, false, log), tool('b', 5, true, log)], { maxParallelTools: 3 });
        await engine.run('go');
        expect(log).toEqual(['a', 'w', 'b']);
    });

    it('a throwing tool does not cancel the others', async () => {
        const bad: ToolDefinition = { ...tool('bad', 5, true), execute: async () => { throw new Error('boom'); } };
        const { engine, results } = run(['bad', 'a'], [bad, tool('a', 20, true)], { maxParallelTools: 2 });
        await engine.run('go');
        const r = results().map(m => m.content);
        expect(r[0]).toContain('boom');
        expect(r[1]).toBe('out-a');
    });

    it('approval prompts are serial and in call order', async () => {
        const order: string[] = [];
        let active = 0, maxActive = 0;
        const { engine } = run(['write_file', 'write_file'], [
            { ...tool('write_file', 1, true) },
        ], {
            maxParallelTools: 2,
            onToolApproval: async (_n: string, _a: string, args: string) => {
                active++; maxActive = Math.max(maxActive, active);
                order.push(args); await sleep(20); active--;
                return 'approve';
            },
        });
        await engine.run('go');
        expect(maxActive).toBe(1);
        expect(order).toHaveLength(2);
    });
});
