import { AgentEngine } from '../AgentEngine';
import type { AgentProfile, LLMProvider, ToolDefinition } from '../../types';
import {
    createMockTransport,
    createTextProvider,
    createToolCallProvider,
    buildRegistries,
    testAgent,
} from '../../__tests__/helpers';

function buildEngine(options: Partial<ConstructorParameters<typeof AgentEngine>[0]> = {}) {
    const provider = createTextProvider('Hello from LLM');
    const { agents, tools, providers } = buildRegistries(provider);
    const { transport } = createMockTransport();

    return new AgentEngine({
        model: { provider: 'mock', id: 'mock' },
        agents,
        tools,
        providers,
        defaultProvider: 'mock',
        transport,
        defaultAgentId: 'test-agent',
        maxIterations: 10,
        ...options,
    });
}

describe('AgentEngine — basic run', () => {
    it('emits ready and done events', async () => {
        const provider = createTextProvider('Hi');
        const { agents, tools, providers } = buildRegistries(provider);
        const { transport, events } = createMockTransport();

        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock',
            transport,
            defaultAgentId: 'test-agent',
        });

        await engine.run('Hello');
        expect(events.some(e => e.type === 'ready')).toBe(true);
        expect(events.some(e => e.type === 'done')).toBe(true);
    });

    it('emits token events with LLM content', async () => {
        const provider = createTextProvider('response text');
        const { agents, tools, providers } = buildRegistries(provider);
        const { transport, events } = createMockTransport();

        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock',
            transport,
            defaultAgentId: 'test-agent',
        });

        await engine.run('Hello');
        const tokens = events.filter(e => e.type === 'token');
        expect(tokens.length).toBeGreaterThan(0);
    });

    it('throws when defaultAgent is not registered', async () => {
        const provider = createTextProvider('x');
        const { agents, tools, providers } = buildRegistries(provider);
        const { transport } = createMockTransport();

        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock',
            transport,
            defaultAgentId: 'nonexistent-agent',
        });

        await expect(engine.run('hi')).rejects.toThrow(/not registered/);
    });
});

describe('AgentEngine — tool execution', () => {
    it('executes a tool and sends result back to LLM', async () => {
        const toolCalls: unknown[] = [];
        const tool: ToolDefinition = {
            name: 'greet',
            description: 'greets',
            parameters: { type: 'object', properties: { name: { type: 'string' } } },
            execute: async (args) => { toolCalls.push(args); return 'Hello, world!'; },
        };

        const agentWithTool: AgentProfile = { ...testAgent, allowedTools: ['greet'] };
        const provider = createToolCallProvider('greet', { name: 'world' }, 'done');
        const { agents, tools, providers } = buildRegistries(provider, agentWithTool);
        tools.register(tool);
        const { transport, events } = createMockTransport();

        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock',
            transport,
            defaultAgentId: 'test-agent',
        });

        await engine.run('Greet someone');
        expect(toolCalls).toHaveLength(1);
        expect(events.some(e => e.type === 'tool_call')).toBe(true);
        expect(events.some(e => e.type === 'tool_result')).toBe(true);
    });

    it('tool not found sends "not found" message back to LLM', async () => {
        // The engine returns 'Tool "..." not found' which doesn't start with 'Error:'
        // so success is emitted as true — verify the preview contains "not found"
        const provider = createToolCallProvider('missing_tool', {}, 'done');
        const { agents, tools, providers } = buildRegistries(provider);
        const { transport, events } = createMockTransport();

        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock',
            transport,
            defaultAgentId: 'test-agent',
        });

        await engine.run('call missing tool');
        const toolResult = events.find(e => e.type === 'tool_result') as { preview?: string } | undefined;
        expect(toolResult?.preview).toContain('not found');
    });
});

describe('AgentEngine — abort / maxIterations', () => {
    it('maxIterations caps the number of LLM calls', async () => {
        // Provider always calls a non-existent tool → engine keeps looping
        let callCount = 0;
        const loopingProvider: LLMProvider = {
            async chat(_messages, _tools, callbacks) {
                callCount++;
                const id = `call_${callCount}`;
                callbacks.onToolCall?.('loop_tool', '{}', id);
                callbacks.onDone({
                    role: 'assistant',
                    content: null,
                    tool_calls: [{ id, type: 'function', function: { name: 'loop_tool', arguments: '{}' } }],
                });
            },
        };

        const { agents, tools, providers } = buildRegistries(loopingProvider);
        const { transport } = createMockTransport();

        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock',
            transport,
            defaultAgentId: 'test-agent',
            maxIterations: 3,
        });

        await engine.run('loop');
        expect(callCount).toBe(3);
    });

    it('abort() mid-run stops the next iteration', async () => {
        let callCount = 0;
        let engineRef: AgentEngine;

        const provider: LLMProvider = {
            async chat(_messages, _tools, callbacks) {
                callCount++;
                // On first call: call a tool to trigger another iteration, then abort
                if (callCount === 1) {
                    const id = 'call_1';
                    callbacks.onToolCall?.('noop', '{}', id);
                    callbacks.onDone({
                        role: 'assistant',
                        content: null,
                        tool_calls: [{ id, type: 'function', function: { name: 'noop', arguments: '{}' } }],
                    });
                    engineRef!.abort();
                } else {
                    callbacks.onChunk?.('final');
                    callbacks.onDone({ role: 'assistant', content: 'final' });
                }
            },
        };

        const { agents, tools, providers } = buildRegistries(provider);
        const { transport } = createMockTransport();

        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock',
            transport,
            defaultAgentId: 'test-agent',
            maxIterations: 100,
        });
        engineRef = engine;

        await engine.run('trigger abort');
        // Called once (first iteration), aborted before second iteration
        expect(callCount).toBe(1);
    });
});

describe('AgentEngine — switchAgent', () => {
    it('switchAgent changes the current agent', () => {
        const provider = createTextProvider('x');
        const { agents, tools, providers } = buildRegistries(provider);
        const secondAgent: AgentProfile = { ...testAgent, id: 'second' };
        agents.upsert(secondAgent);
        const { transport } = createMockTransport();

        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock',
            transport,
            defaultAgentId: 'test-agent',
        });

        expect(() => engine.switchAgent('second')).not.toThrow();
    });

    it('switchAgent throws for unknown agent', () => {
        const engine = buildEngine();
        expect(() => engine.switchAgent('ghost')).toThrow(/not found/);
    });
});
