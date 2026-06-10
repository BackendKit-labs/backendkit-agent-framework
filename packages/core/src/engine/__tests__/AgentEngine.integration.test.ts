import { existsSync, unlinkSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentEngine } from '../AgentEngine';
import { DelegationBus } from '../../delegation/DelegationBus';
import type { AgentProfile, LLMMessage, LLMProvider, ToolDefinition } from '../../types';
import {
    buildRegistries,
    createMockTransport,
    createScriptedProvider,
    createTextProvider,
    testAgent,
} from '../../__tests__/helpers';

// Shared engine builder — keeps test setup concise.
function buildEngine(
    provider: LLMProvider,
    overrides: Partial<ConstructorParameters<typeof AgentEngine>[0]> = {},
    agent: AgentProfile = testAgent,
) {
    const { agents, tools, providers } = buildRegistries(provider, agent);
    const { transport, events } = createMockTransport();
    const engine = new AgentEngine({
        model: { provider: 'mock', id: 'mock' },
        agents, tools, providers,
        defaultProvider: 'mock',
        transport,
        defaultAgentId: testAgent.id,
        iterationMode: 'auto',
        maxIterations: 10,
        ...overrides,
    });
    return { engine, agents, tools, providers, transport, events };
}

// ── 1.1 — abort() mid-tool chain → next run() sanitizes history ──────────────

describe('1.1 — abort() mid-tool chain: sanitizeMessages strips incomplete chain', () => {
    it('second run() LLM call receives no incomplete assistant→tool chain', async () => {
        let engineRef!: AgentEngine;
        let secondCallMessages: LLMMessage[] = [];
        let callCount = 0;

        const provider: LLMProvider = {
            async chat(messages, _tools, callbacks) {
                callCount++;
                if (callCount === 1) {
                    // Two tool calls — abort_me executes and aborts before never_called runs.
                    callbacks.onToolCall?.('abort_me', '{}', 'tc1');
                    callbacks.onToolCall?.('never_called', '{}', 'tc2');
                    callbacks.onDone({
                        role: 'assistant',
                        content: null,
                        tool_calls: [
                            { id: 'tc1', type: 'function', function: { name: 'abort_me', arguments: '{}' } },
                            { id: 'tc2', type: 'function', function: { name: 'never_called', arguments: '{}' } },
                        ],
                    });
                } else {
                    secondCallMessages = messages.filter(m => m.role !== 'system');
                    callbacks.onChunk?.('ok');
                    callbacks.onDone({ role: 'assistant', content: 'ok' });
                }
            },
        };

        const abortTool: ToolDefinition = {
            name: 'abort_me', description: 'aborts the engine',
            parameters: { type: 'object', properties: {} },
            execute: async () => { engineRef.abort(); return 'aborting'; },
        };
        const neverTool: ToolDefinition = {
            name: 'never_called', description: 'must not execute',
            parameters: { type: 'object', properties: {} },
            execute: async () => { throw new Error('should not be called'); },
        };

        const agent: AgentProfile = { ...testAgent, allowedTools: ['abort_me', 'never_called'] };
        const { agents, tools, providers } = buildRegistries(provider, agent);
        tools.register(abortTool);
        tools.register(neverTool);
        const { transport } = createMockTransport();

        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock', transport,
            defaultAgentId: testAgent.id,
            iterationMode: 'auto',
        });
        engineRef = engine;

        await engine.run('first');
        await engine.run('second');

        expect(callCount).toBe(2);

        // Every assistant message with tool_calls must have a result for each declared ID
        for (let i = 0; i < secondCallMessages.length; i++) {
            const msg = secondCallMessages[i];
            if (msg.role !== 'assistant' || !msg.tool_calls?.length) continue;
            const pending = new Set(msg.tool_calls.map(tc => tc.id));
            let j = i + 1;
            while (j < secondCallMessages.length && secondCallMessages[j].role === 'tool') {
                const tm = secondCallMessages[j] as { tool_call_id?: string };
                if (tm.tool_call_id) pending.delete(tm.tool_call_id);
                j++;
            }
            expect(pending.size).toBe(0); // no unresolved tool_call IDs
        }
    });
});

// ── 1.2 — 3 ask_agent calls in one turn → parallel execution ─────────────────

describe('1.2 — 3 ask_agent calls: results mapped to correct tool_call_ids', () => {
    it('each specialist result is mapped to its own tool message', async () => {
        let orchCallCount = 0;

        const orchestratorProvider: LLMProvider = {
            async chat(_messages, _tools, callbacks) {
                orchCallCount++;
                if (orchCallCount === 1) {
                    const calls = [
                        { id: 'tc-a', agent: 'alpha', q: 'compute-a' },
                        { id: 'tc-b', agent: 'beta',  q: 'compute-b' },
                        { id: 'tc-c', agent: 'gamma', q: 'compute-c' },
                    ];
                    for (const c of calls) {
                        callbacks.onToolCall?.(
                            'ask_agent',
                            JSON.stringify({ agent_id: c.agent, question: c.q }),
                            c.id,
                        );
                    }
                    callbacks.onDone({
                        role: 'assistant',
                        content: null,
                        tool_calls: calls.map(c => ({
                            id: c.id,
                            type: 'function',
                            function: { name: 'ask_agent', arguments: JSON.stringify({ agent_id: c.agent, question: c.q }) },
                        })),
                    });
                } else {
                    callbacks.onChunk?.('all done');
                    callbacks.onDone({ role: 'assistant', content: 'all done' });
                }
            },
        };

        const makeSpecialist = (id: string, reply: string): AgentProfile => ({
            id, name: id, icon: '⚙', description: id,
            systemPrompt: `You are ${id}.`,
            allowedTools: [], delegatesTo: [],
        });

        const orchestratorAgent: AgentProfile = { ...testAgent, delegatesTo: ['alpha', 'beta', 'gamma'] };
        const { agents, tools, providers } = buildRegistries(orchestratorProvider, orchestratorAgent);

        for (const [id, reply] of [['alpha', 'result-A'], ['beta', 'result-B'], ['gamma', 'result-C']] as const) {
            agents.upsert(makeSpecialist(id, reply));
            const specialistProvider: LLMProvider = {
                async chat(_messages, _tools, callbacks) {
                    callbacks.onChunk?.(reply);
                    callbacks.onDone({ role: 'assistant', content: reply });
                },
            };
            providers.register(id, specialistProvider);
            agents.get(id)!.provider = id;
            agents.upsert(agents.get(id)!);
        }

        const { transport, events } = createMockTransport();
        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock', transport,
            defaultAgentId: testAgent.id,
            iterationMode: 'auto', maxIterations: 10,
        });

        await engine.run('delegate all three');

        const toolResults = events.filter(e => e.type === 'tool_result');
        // All three ask_agent results were received
        expect(toolResults.length).toBeGreaterThanOrEqual(3);
    });
});

// ── 1.3 — nested delegation (depth=1) bypasses bulkhead ──────────────────────

describe('1.3 — nested delegation: depth > 0 bypasses full bulkhead', () => {
    it('depth=1 call completes while depth=0 slot is occupied', async () => {
        const completionOrder: number[] = [];
        let unblockSlow!: () => void;
        const slowDone = new Promise<void>(r => { unblockSlow = r; });

        const agent: AgentProfile = { ...testAgent };
        const agents = buildRegistries(createTextProvider('x'), agent).agents;
        const { transport } = createMockTransport();

        const bus = new DelegationBus({
            maxParallel: 1,
            agents,
            transport,
            runAgent: async (agentId) => {
                if (agentId === 'slow') {
                    await slowDone;
                    completionOrder.push(0);
                } else {
                    completionOrder.push(1); // nested: completes immediately
                }
                return { agentId, content: 'done', inputTokens: 0, outputTokens: 0, elapsedMs: 0 };
            },
        });

        // Register both agents so DelegationBus can find them
        const slowAgent: AgentProfile = { id: 'slow', name: 'Slow', icon: '🐢', description: 'slow', systemPrompt: '', allowedTools: [], delegatesTo: [] };
        const fastAgent: AgentProfile = { id: 'fast', name: 'Fast', icon: '🐇', description: 'fast', systemPrompt: '', allowedTools: [], delegatesTo: [] };
        agents.upsert(slowAgent);
        agents.upsert(fastAgent);

        // Start depth=0 call — occupies the only bulkhead slot (blocks)
        const slowCall = bus.runSingle({ agentId: 'slow', question: 'q', depth: 0 });

        // Give the slow call a tick to acquire the bulkhead slot
        await Promise.resolve();

        // depth=1 should bypass the bulkhead and complete immediately
        const nestedCall = bus.runSingle({ agentId: 'fast', question: 'q', depth: 1 });

        unblockSlow();
        await Promise.all([slowCall, nestedCall]);

        // Nested (depth=1) completed before the slow depth=0 call
        expect(completionOrder).toEqual([1, 0]);
    });
});

// ── 1.4 — concurrent run() calls are serialized by mutex ─────────────────────

describe('1.4 — concurrent run(): mutex serializes access', () => {
    it('second run() starts only after first run() completes', async () => {
        const llmCallOrder: string[] = [];
        let unblockFirst!: () => void;
        const firstDone = new Promise<void>(r => { unblockFirst = r; });

        const provider: LLMProvider = {
            async chat(messages, _tools, callbacks) {
                const userMsg = [...messages].reverse().find(m => m.role === 'user');
                const label = typeof userMsg?.content === 'string' ? userMsg.content : '?';
                llmCallOrder.push(label);
                if (label === 'first') await firstDone;
                callbacks.onChunk?.(label);
                callbacks.onDone({ role: 'assistant', content: label });
            },
        };

        const { engine } = buildEngine(provider);

        const run1 = engine.run('first');
        const run2 = engine.run('second');

        // Allow run1 to enter the LLM call (one microtask tick)
        await Promise.resolve();
        await Promise.resolve();

        unblockFirst();
        await Promise.all([run1, run2]);

        expect(llmCallOrder).toEqual(['first', 'second']);
    });
});

// ── 1.5 — history round-trip (save + load via historyPath) ───────────────────

describe('1.5 — history round-trip: save and restore across engine instances', () => {
    const historyPath = path.join(os.tmpdir(), `bk-history-${Date.now()}.json`);

    afterAll(() => { try { unlinkSync(historyPath); } catch {} });

    it('second engine instance receives first conversation in history', async () => {
        // Engine 1 — run once and save
        const { agents, tools, providers } = buildRegistries(createTextProvider('reply-1'));
        const { transport: t1 } = createMockTransport();
        const engine1 = new AgentEngine({
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock', transport: t1,
            defaultAgentId: testAgent.id,
            iterationMode: 'auto',
            historyPath,
        });
        await engine1.run('turn-one');
        expect(existsSync(historyPath)).toBe(true);

        // Engine 2 — loads the saved history
        let capturedMessages: LLMMessage[] = [];
        const provider2: LLMProvider = {
            async chat(messages, _tools, callbacks) {
                capturedMessages = [...messages];
                callbacks.onDone({ role: 'assistant', content: 'reply-2' });
            },
        };
        const { agents: a2, tools: t2, providers: p2 } = buildRegistries(provider2);
        const { transport: tr2 } = createMockTransport();
        const engine2 = new AgentEngine({
            model: { provider: 'mock', id: 'mock' },
            agents: a2, tools: t2, providers: p2,
            defaultProvider: 'mock', transport: tr2,
            defaultAgentId: testAgent.id,
            iterationMode: 'auto',
            historyPath,
        });
        await engine2.run('turn-two');

        const userMessages = capturedMessages.filter(m => m.role === 'user').map(m => m.content);
        expect(userMessages).toContain('turn-one');
        expect(userMessages).toContain('turn-two');
    });
});

// ── 1.6 — toolTrigger goes through executeToolCall (auth + events) ────────────

describe('1.6 — toolTrigger: routes through executeToolCall', () => {
    it('emits tool_result event and skips LLM when trigger keyword matches', async () => {
        let toolCalled = false;
        const mcpTool: ToolDefinition = {
            name: 'mcp__lookup__search',
            description: '[MCP:lookup] Search',
            parameters: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] },
            execute: async () => { toolCalled = true; return 'search-result'; },
        };

        const provider = createTextProvider('done');
        const { agents, tools, providers } = buildRegistries(provider);
        const { transport, events } = createMockTransport();

        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock', transport,
            defaultAgentId: testAgent.id,
            iterationMode: 'auto',
        });

        // Register MCP agent via internal MCPRegistrar (accessed for test setup only)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (engine as any).mcpRegistrar.registerAgent(
            { name: 'lookup', mode: 'tools', toolTriggers: { 'search': 'search' } },
            [mcpTool],
        );

        await engine.run('search show all users');

        // Tool executed via trigger path
        expect(toolCalled).toBe(true);
        // executeToolCall was used — tool_result event emitted
        expect(events.some(e => e.type === 'tool_result')).toBe(true);
        // LLM loop was not entered — no block_start for the main (default) agent
        const mainAgentBlock = events.find(
            e => e.type === 'block_start' && (e as { agent_id?: string }).agent_id === testAgent.id,
        );
        expect(mainAgentBlock).toBeUndefined();
    });
});

// ── 1.7 — onToolApproval: reject blocks execution ────────────────────────────

describe('1.7 — onToolApproval: reject prevents tool execution', () => {
    it('write_file is not called when approval is rejected', async () => {
        let fileWritten = false;
        const writeTool: ToolDefinition = {
            name: 'write_file',
            description: 'writes a file',
            parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } },
            execute: async () => { fileWritten = true; return 'written'; },
        };

        const agent: AgentProfile = { ...testAgent, allowedTools: ['write_file'] };
        const provider = createScriptedProvider([
            { tool_calls: [{ id: 'tc1', name: 'write_file', args: { path: 'out.ts', content: 'x' } }] },
            { content: 'done' },
        ]);
        const { agents, tools, providers } = buildRegistries(provider, agent);
        tools.register(writeTool);
        const { transport, events } = createMockTransport();

        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock', transport,
            defaultAgentId: testAgent.id,
            iterationMode: 'auto',
            onToolApproval: async () => 'reject',
        });

        await engine.run('write the file');

        expect(fileWritten).toBe(false);
        const toolResult = events.find(e => e.type === 'tool_result') as { type: 'tool_result'; preview?: string; success?: boolean } | undefined;
        expect(toolResult?.success).toBe(false);
        expect(toolResult?.preview).toContain('rejected');
    });
});

// ── 1.8 — maxIterations applies to sub-agents ────────────────────────────────

describe('1.8 — sub-agent maxIterations: uses engine config, not hardcoded', () => {
    it('sub-agent stops after maxIterations iterations', async () => {
        let subIterations = 0;
        const loopProvider: LLMProvider = {
            async chat(_messages, _tools, callbacks) {
                subIterations++;
                const id = `c${subIterations}`;
                callbacks.onToolCall?.('loop_t', '{}', id);
                callbacks.onDone({
                    role: 'assistant', content: null,
                    tool_calls: [{ id, type: 'function', function: { name: 'loop_t', arguments: '{}' } }],
                });
            },
        };

        const loopTool: ToolDefinition = {
            name: 'loop_t', description: 'loops',
            parameters: { type: 'object', properties: {} },
            execute: async () => 'loop',
        };

        const specialist: AgentProfile = {
            id: 'looper', name: 'Looper', icon: '🔄', description: 'loops forever',
            systemPrompt: '', allowedTools: ['loop_t'], delegatesTo: [],
            provider: 'loop-provider',
        };

        let orchCall = 0;
        const orchProvider: LLMProvider = {
            async chat(_messages, _tools, callbacks) {
                orchCall++;
                if (orchCall === 1) {
                    const arg = JSON.stringify({ agent_id: 'looper', question: 'loop' });
                    callbacks.onToolCall?.('ask_agent', arg, 'tc1');
                    callbacks.onDone({
                        role: 'assistant', content: null,
                        tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'ask_agent', arguments: arg } }],
                    });
                } else {
                    callbacks.onChunk?.('done'); callbacks.onDone({ role: 'assistant', content: 'done' });
                }
            },
        };

        const orchAgent: AgentProfile = { ...testAgent, delegatesTo: ['looper'] };
        const { agents, tools, providers } = buildRegistries(orchProvider, orchAgent);
        agents.upsert(specialist);
        providers.register('loop-provider', loopProvider);
        tools.register(loopTool);
        const { transport } = createMockTransport();

        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock', transport,
            defaultAgentId: testAgent.id,
            iterationMode: 'auto',
            maxIterations: 3,
        });

        await engine.run('delegate looper');

        expect(subIterations).toBe(3);
    });
});

// ── 1.9 — parallel agent output blocks are non-interleaved ───────────────────

describe('1.9 — parallel agent events: block_start…block_end are contiguous', () => {
    it('each sub-agent block is not interleaved with another sub-agent\'s block', async () => {
        let orchCall = 0;
        const orchProvider: LLMProvider = {
            async chat(_messages, _tools, callbacks) {
                orchCall++;
                if (orchCall === 1) {
                    const asks = [
                        { id: 'ta', agent: 'agent-x', q: 'x' },
                        { id: 'tb', agent: 'agent-y', q: 'y' },
                    ];
                    for (const a of asks) {
                        callbacks.onToolCall?.('ask_agent', JSON.stringify({ agent_id: a.agent, question: a.q }), a.id);
                    }
                    callbacks.onDone({
                        role: 'assistant', content: null,
                        tool_calls: asks.map(a => ({ id: a.id, type: 'function', function: { name: 'ask_agent', arguments: JSON.stringify({ agent_id: a.agent, question: a.q }) } })),
                    });
                } else {
                    callbacks.onDone({ role: 'assistant', content: 'ok' });
                }
            },
        };

        const orchAgent: AgentProfile = { ...testAgent, delegatesTo: ['agent-x', 'agent-y'] };
        const { agents, tools, providers } = buildRegistries(orchProvider, orchAgent);

        for (const id of ['agent-x', 'agent-y']) {
            agents.upsert({ id, name: id, icon: '⚡', description: id, systemPrompt: '', allowedTools: [], delegatesTo: [] });
            const sp: LLMProvider = {
                async chat(_m, _t, callbacks) {
                    callbacks.onChunk?.(`token-${id}`);
                    callbacks.onDone({ role: 'assistant', content: `token-${id}` });
                },
            };
            providers.register(id, sp);
            const ag = agents.get(id)!;
            ag.provider = id;
            agents.upsert(ag);
        }

        const { transport, events } = createMockTransport();
        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock', transport,
            defaultAgentId: testAgent.id,
            iterationMode: 'auto', maxIterations: 10,
        });

        await engine.run('parallel');

        // For each sub-agent, its block_start must come before its block_end,
        // and no other sub-agent's block events should appear in between.
        for (const agentId of ['agent-x', 'agent-y']) {
            const startIdx = events.findIndex(e => e.type === 'block_start' && (e as { agent_id?: string }).agent_id === agentId);
            const endIdx   = events.findIndex(e => e.type === 'block_end'   && (e as { agent_id?: string }).agent_id === agentId);
            expect(startIdx).toBeGreaterThanOrEqual(0);
            expect(endIdx).toBeGreaterThan(startIdx);

            const otherId = agentId === 'agent-x' ? 'agent-y' : 'agent-x';
            const interleaved = events
                .slice(startIdx + 1, endIdx)
                .some(e => (e as { agent_id?: string }).agent_id === otherId && (e.type === 'block_start' || e.type === 'token'));
            expect(interleaved).toBe(false);
        }
    });
});

// ── 1.10 — loadAgents Promise cache: one load per engine ─────────────────────

describe('1.10 — loadAgents Promise cache: concurrent calls share one load', () => {
    it('loadAgents is invoked only once even with concurrent ensureAgentsLoaded calls', async () => {
        let loadCount = 0;
        let resolveLoad!: (v: AgentProfile[]) => void;
        const loadPending = new Promise<AgentProfile[]>(r => { resolveLoad = r; });

        const loadAgents = async (): Promise<AgentProfile[]> => {
            loadCount++;
            return loadPending;
        };

        const provider = createTextProvider('done');
        const { agents, tools, providers } = buildRegistries(provider);
        const { transport } = createMockTransport();

        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock', transport,
            defaultAgentId: testAgent.id,
            iterationMode: 'auto',
            loadAgents,
        });

        // Access the private ensureAgentsLoaded to fire two concurrent calls
        type Priv = { ensureAgentsLoaded: () => Promise<void> };
        const priv = engine as unknown as Priv;

        const p1 = priv.ensureAgentsLoaded();
        const p2 = priv.ensureAgentsLoaded();

        resolveLoad([]);
        await Promise.all([p1, p2]);

        expect(loadCount).toBe(1);
    });
});
