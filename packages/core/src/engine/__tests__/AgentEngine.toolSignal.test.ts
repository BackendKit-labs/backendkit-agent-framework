import { AgentEngine } from '../AgentEngine';
import { defineTool, z } from '../../tools/defineTool';
import type { AgentProfile, ExecutionContext, LLMMessage, LLMProvider } from '../../types';
import { buildRegistries, createMockTransport, testAgent } from '../../__tests__/helpers';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const agent: AgentProfile = { ...testAgent, allowedTools: ['slow', 'quick', 'stubborn'] };

/** Calls every requested tool in one turn, then answers with text. */
function toolThenText(calls: string[]) {
    const seen: LLMMessage[][] = [];
    let turn = 0;
    const provider: LLMProvider = {
        async chat(messages, _t, cb) {
            seen.push(messages);
            if (turn++ === 0) {
                const tc = calls.map((name, i) => ({ id: `c${i}`, type: 'function' as const, function: { name, arguments: '{}' } }));
                for (const c of tc) cb.onToolCall?.(c.function.name, '{}', c.id);
                cb.onDone({ role: 'assistant', content: null, tool_calls: tc });
            } else {
                cb.onChunk?.('done');
                cb.onDone({ role: 'assistant', content: 'done' });
            }
        },
    };
    return { provider, seen };
}

function build(provider: LLMProvider, tools: ReturnType<typeof defineTool>[], extra: Partial<ConstructorParameters<typeof AgentEngine>[0]> = {}, allowed: string[] = []) {
    const { agents, tools: registry, providers } = buildRegistries(provider, { ...agent, allowedTools: [...agent.allowedTools, ...allowed] });
    for (const t of tools) registry.register(t);
    const { transport, events } = createMockTransport();
    const engine = new AgentEngine({
        model: { provider: 'mock', id: 'mock' }, agents, tools: registry, providers,
        defaultProvider: 'mock', transport, defaultAgentId: 'test-agent', iterationMode: 'auto', ...extra,
    });
    return { engine, events };
}

const toolMessages = (seen: LLMMessage[][]) => seen[seen.length - 1].filter(m => m.role === 'tool');
const resultsOf = (events: ReturnType<typeof createMockTransport>['events']) =>
    events.filter((e): e is Extract<typeof e, { type: 'tool_result' }> => e.type === 'tool_result');

/** A tool that does `ms` of work but stops as soon as its signal fires. */
const cooperative = (name: string, ms: number, onSignal?: (ctx: ExecutionContext) => void) => defineTool({
    name, description: name, input: z.object({}),
    execute: async (_a, ctx) => {
        onSignal?.(ctx);
        await new Promise<void>((resolve, reject) => {
            const t = setTimeout(resolve, ms);
            ctx.signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('stopped by signal')); }, { once: true });
        });
        return `${name} finished`;
    },
});

describe('AgentEngine — tool signal and time limit', () => {
    it('gives every tool call a signal, even with no time limit configured', async () => {
        let received: AbortSignal | undefined;
        const { provider } = toolThenText(['quick']);
        const quick = defineTool({ name: 'quick', description: 'q', input: z.object({}), execute: async (_a, ctx) => { received = ctx.signal; return 'ok'; } });
        const { engine } = build(provider, [quick]);
        await engine.run('go');
        expect(received).toBeInstanceOf(AbortSignal);
        expect(received!.aborted).toBe(false);
    });

    it('a tool that exceeds its own timeoutMs gets TOOL_TIMEOUT and its late result is discarded', async () => {
        let finished = false;
        const slow = defineTool({
            name: 'slow', description: 's', input: z.object({}), timeoutMs: 40,
            execute: async () => { await sleep(300); finished = true; return 'LATE RESULT'; },
        });
        const { provider, seen } = toolThenText(['slow']);
        const { engine, events } = build(provider, [slow], { toolTimeoutGraceMs: 10 });
        const started = Date.now();
        await engine.run('go');

        expect(Date.now() - started).toBeLessThan(250);
        expect(toolMessages(seen)[0].content).toContain('TOOL_TIMEOUT');
        expect(toolMessages(seen)[0].content).toContain('exceeded 40ms');
        expect(resultsOf(events)[0]).toMatchObject({ success: false, outcome: 'timeout' });

        await sleep(350);                       // the tool does finish, and nothing changes
        expect(finished).toBe(true);
        await engine.run('again');
        expect(JSON.stringify(seen)).not.toContain('LATE RESULT');
    });

    it('the engine toolTimeoutMs applies to tools without their own limit; the tool limit wins when set', async () => {
        const slow = cooperative('slow', 400);
        const quick = defineTool({ name: 'quick', description: 'q', input: z.object({}), timeoutMs: 1000, execute: async () => { await sleep(80); return 'quick ok'; } });
        const { provider, seen } = toolThenText(['slow', 'quick']);
        const { engine, events } = build(provider, [slow, quick], { toolTimeoutMs: 40, toolTimeoutGraceMs: 10 });
        await engine.run('go');
        const results = resultsOf(events);
        expect(results.find(r => r.name === 'slow')).toMatchObject({ success: false, outcome: 'timeout' });
        expect(results.find(r => r.name === 'quick')).toMatchObject({ success: true });
        expect(toolMessages(seen).map(m => m.content)).toEqual([expect.stringContaining('TOOL_TIMEOUT'), 'quick ok']);
    });

    it('the signal given to a timed-out tool is aborted so it can stop working', async () => {
        let signal: AbortSignal | undefined;
        const { provider } = toolThenText(['slow']);
        const { engine } = build(provider, [cooperative('slow', 1000, ctx => { signal = ctx.signal; })], { toolTimeoutMs: 30, toolTimeoutGraceMs: 50 });
        await engine.run('go');
        expect(signal!.aborted).toBe(true);
        expect(signal!.reason).toBe('timeout');
    });

    it('a tool that ignores its signal is given up on after the grace period', async () => {
        const stubborn = defineTool({ name: 'stubborn', description: 's', input: z.object({}), timeoutMs: 20, execute: async () => { await sleep(500); return 'x'; } });
        const { provider, seen } = toolThenText(['stubborn']);
        const { engine } = build(provider, [stubborn], { toolTimeoutGraceMs: 30 });
        const started = Date.now();
        await engine.run('go');
        expect(Date.now() - started).toBeLessThan(300);
        expect(toolMessages(seen)[0].content).toContain('TOOL_TIMEOUT');
    });

    it('engine.abort() cancels a running tool, which reports "aborted" and leaves the history paired', async () => {
        const { provider, seen } = toolThenText(['slow']);
        let signal: AbortSignal | undefined;
        const { engine, events } = build(provider, [cooperative('slow', 5000, ctx => { signal = ctx.signal; })]);
        const run = engine.run('go');
        await sleep(40);
        const abortedAt = Date.now();
        engine.abort();
        await run;

        expect(Date.now() - abortedAt).toBeLessThan(500);
        expect(signal!.aborted).toBe(true);
        expect(resultsOf(events)[0]).toMatchObject({ success: false, outcome: 'aborted' });

        await engine.run('next');               // history stays valid for the provider
        const tool = seen[seen.length - 1].filter(m => m.role === 'tool');
        expect(tool.length).toBeLessThanOrEqual(1);
    });

    it('one tool timing out in a parallel wave does not affect the others', async () => {
        const safe = (name: string, ms: number, limit?: number) => defineTool({
            name, description: name, input: z.object({}), concurrencySafe: true, ...(limit ? { timeoutMs: limit } : {}),
            execute: async () => { await sleep(ms); return `${name} ok`; },
        });
        const { provider, seen } = toolThenText(['slow', 'quick']);
        const { engine, events } = build(provider, [safe('slow', 300, 30), safe('quick', 20)], { maxParallelTools: 2, toolTimeoutGraceMs: 10 });
        await engine.run('go');
        expect(resultsOf(events).map(r => [r.name, r.success])).toEqual([['slow', false], ['quick', true]]);
        expect(toolMessages(seen).map(m => m.content)).toEqual([expect.stringContaining('TOOL_TIMEOUT'), 'quick ok']);
    });

    it('does not count time spent waiting for approval', async () => {
        const write = defineTool({ name: 'write_file', description: 'w', input: z.object({}), timeoutMs: 60, execute: async () => 'written' });
        const { provider, seen } = toolThenText(['write_file']);
        const { engine } = build(provider, [write], {
            onToolApproval: async () => { await sleep(200); return 'approve'; },    // far longer than the 60 ms limit
        }, ['write_file']);
        await engine.run('go');
        expect(toolMessages(seen)[0].content).toBe('written');
    });

    it('releases controllers and timers after every call', async () => {
        const { provider } = toolThenText(['quick']);
        const quick = defineTool({ name: 'quick', description: 'q', input: z.object({}), timeoutMs: 5000, execute: async () => 'ok' });
        const { engine } = build(provider, [quick]);
        await engine.run('go');
        expect((engine as unknown as { toolControllers: Set<unknown> }).toolControllers.size).toBe(0);
    });

    it('defineTool propagates timeoutMs and omits it when unset', () => {
        const a = defineTool({ name: 'a', description: 'a', input: z.object({}), timeoutMs: 123, execute: async () => '' });
        const b = defineTool({ name: 'b', description: 'b', input: z.object({}), execute: async () => '' });
        expect(a.timeoutMs).toBe(123);
        expect(b).not.toHaveProperty('timeoutMs');
    });
});
