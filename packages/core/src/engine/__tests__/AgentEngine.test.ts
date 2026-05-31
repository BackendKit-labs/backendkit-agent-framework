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

// ── Orchestration brief injection ─────────────────────────────────────────────

describe('AgentEngine — orchestration brief in system prompt', () => {
    /**
     * Creates a mock Orchestrator that returns a fixed OrchestrationResult.
     * The mock is minimal — only the orchestrate() method is needed.
     */
    function makeMockOrchestrator(result: import('../../orchestration/types').OrchestrationResult) {
        return { orchestrate: async () => result } as unknown as import('../../orchestration/orchestrator').Orchestrator;
    }

    /** Captures the system message content passed to the LLM on each chat() call. */
    function captureSystemMessages(): { provider: LLMProvider; captured: string[] } {
        const captured: string[] = [];
        const provider: LLMProvider = {
            async chat(messages, _tools, callbacks) {
                const sys = messages.find(m => m.role === 'system');
                if (sys?.content) captured.push(sys.content as string);
                callbacks.onChunk?.('done');
                callbacks.onDone({ role: 'assistant', content: 'done' });
            },
        };
        return { provider, captured };
    }

    it('injects the orchestration brief into the default agent system prompt', async () => {
        const { provider, captured } = captureSystemMessages();
        const { agents, tools, providers } = buildRegistries(provider);
        const { transport } = createMockTransport();

        const orchResult: import('../../orchestration/types').OrchestrationResult = {
            task: {
                taskId: 't1',
                rawPrompt: 'add circuit breaker',
                actionType: 'implementation',
                domains: ['resilience', 'backend'],
                riskLevel: 'high',
                riskFactors: { breaking_change: false, security_sensitive: false, cross_service_impact: true, db_transactional: false, production_critical: false, complexity: 5 },
                requiresQaApproval: true,
                requiresSecurityReview: false,
                requiresArchitectureReview: false,
                assignedAgents: ['backend-agent'],
                targetServices: [],
                relatedPatterns: [],
                status: 'classified',
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            selectedAgents: [
                { agentId: 'backend-agent', score: 100, reason: 'Politica obligatoria' },
                { agentId: 'qa-engineer', score: 100, reason: 'riskLevel=high | critical' },
            ],
            agentPipeline: [
                { phase: 'implement', agentId: 'backend-agent', purpose: 'Implement circuit breaker', optional: false },
                { phase: 'verify', agentId: 'qa-engineer', purpose: 'Verify implementation quality', optional: false },
            ],
            appliedPolicies: [{ rule: 'riskLevel=high | critical', reason: 'riskLevel=high | critical' }],
            requiredGates: ['qa'],
            commitAllowed: false,
        };

        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock',
            transport,
            defaultAgentId: 'test-agent',
            maxIterations: 1,
            orchestrator: makeMockOrchestrator(orchResult),
        });

        await engine.run('add circuit breaker to the resilience module');

        expect(captured.length).toBeGreaterThan(0);
        const systemPrompt = captured[0];

        // Brief must be present
        expect(systemPrompt).toContain('Orchestrator Analysis');
        // Task metadata
        expect(systemPrompt).toContain('implementation');
        expect(systemPrompt).toContain('high');
        expect(systemPrompt).toContain('resilience');
        // Recommended agents
        expect(systemPrompt).toContain('backend-agent');
        expect(systemPrompt).toContain('qa-engineer');
        // Pipeline
        expect(systemPrompt).toContain('[implement]');
        expect(systemPrompt).toContain('[verify]');
        // Gate
        expect(systemPrompt).toContain('qa');
    });

    it('does not inject orchestration brief when orchestrator is not configured', async () => {
        const { provider, captured } = captureSystemMessages();
        const { agents, tools, providers } = buildRegistries(provider);
        const { transport } = createMockTransport();

        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock',
            transport,
            defaultAgentId: 'test-agent',
            maxIterations: 1,
            // No orchestrator
        });

        await engine.run('simple question');
        expect(captured[0]).not.toContain('Orchestrator Analysis');
    });

    it('does not inject orchestration brief for sole-fallback general agent selection', async () => {
        const { provider, captured } = captureSystemMessages();
        const { agents, tools, providers } = buildRegistries(provider);
        const { transport } = createMockTransport();

        const orchResult: import('../../orchestration/types').OrchestrationResult = {
            task: {
                taskId: 't2', rawPrompt: 'hello', actionType: 'unknown', domains: [],
                riskLevel: 'low',
                riskFactors: { breaking_change: false, security_sensitive: false, cross_service_impact: false, db_transactional: false, production_critical: false, complexity: 1 },
                requiresQaApproval: false, requiresSecurityReview: false, requiresArchitectureReview: false,
                assignedAgents: [], targetServices: [], relatedPatterns: [],
                status: 'classified', createdAt: new Date(), updatedAt: new Date(),
            },
            // Only the fallback — should not appear in the brief
            selectedAgents: [{ agentId: 'general', score: 50, reason: 'Fallback: agente general' }],
            agentPipeline: undefined,
            appliedPolicies: [],
            requiredGates: [],
            commitAllowed: true,
        };

        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock',
            transport,
            defaultAgentId: 'test-agent',
            maxIterations: 1,
            orchestrator: makeMockOrchestrator(orchResult),
        });

        await engine.run('hello');
        // Brief header still present (it always renders task metadata),
        // but no recommended-agents section since it's just the fallback
        const systemPrompt = captured[0];
        expect(systemPrompt).toContain('Orchestrator Analysis');
        expect(systemPrompt).not.toContain('Recommended agents');
    });
});

// ── Token agent_id tagging ─────────────────────────────────────────────────────

describe('AgentEngine — token events carry agent_id', () => {
    it('token events from the main agent carry its agent_id', async () => {
        const provider = createTextProvider('hello world');
        const { agents, tools, providers } = buildRegistries(provider);
        const { transport, events } = createMockTransport();

        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock',
            transport,
            defaultAgentId: 'test-agent',
        });

        await engine.run('say hello');

        const tokenEvents = events.filter(e => e.type === 'token');
        expect(tokenEvents.length).toBeGreaterThan(0);
        for (const evt of tokenEvents) {
            // All tokens from the main agent must be tagged
            expect((evt as { type: 'token'; content: string; agent_id?: string }).agent_id)
                .toBe('test-agent');
        }
    });

    it('token events from sub-agents carry the sub-agent id, not the orchestrator id', async () => {
        // Orchestrator delegates to 'specialist' via ask_agent, then gives a final reply.
        let callCount = 0;
        const orchestratorProvider: LLMProvider = {
            async chat(_messages, _tools, callbacks) {
                callCount++;
                if (callCount === 1) {
                    // First call: delegate to specialist
                    callbacks.onToolCall?.(
                        'ask_agent',
                        JSON.stringify({ agent_id: 'specialist', question: 'compute' }),
                        'tc1',
                    );
                    callbacks.onDone({
                        role: 'assistant',
                        content: null,
                        tool_calls: [{
                            id: 'tc1',
                            type: 'function',
                            function: { name: 'ask_agent', arguments: JSON.stringify({ agent_id: 'specialist', question: 'compute' }) },
                        }],
                    });
                } else {
                    // Second call: final response after getting specialist result
                    callbacks.onChunk?.('orchestrator-final');
                    callbacks.onDone({ role: 'assistant', content: 'orchestrator-final' });
                }
            },
        };

        const specialistProvider: LLMProvider = {
            async chat(_messages, _tools, callbacks) {
                callbacks.onChunk?.('specialist-token');
                callbacks.onDone({ role: 'assistant', content: 'specialist-result' });
            },
        };

        const specialist: AgentProfile = {
            id: 'specialist',
            name: 'Specialist',
            icon: '🔬',
            description: 'A specialist',
            systemPrompt: 'You are a specialist.',
            allowedTools: [],
            delegatesTo: [],
        };

        const orchestratorAgent: AgentProfile = {
            ...testAgent,
            delegatesTo: ['specialist'],
        };

        const { agents, tools, providers } = buildRegistries(orchestratorProvider, orchestratorAgent);
        agents.upsert(specialist);
        providers.register('specialist-provider', specialistProvider);
        specialist.provider = 'specialist-provider';
        agents.upsert(specialist);

        const { transport, events } = createMockTransport();

        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock',
            transport,
            defaultAgentId: 'test-agent',
            maxIterations: 10,
        });

        await engine.run('delegate to specialist');

        const tokenEvents = events.filter(
            e => e.type === 'token'
        ) as Array<{ type: 'token'; content: string; agent_id?: string }>;

        expect(tokenEvents.length).toBeGreaterThan(0);

        // Every token must carry an agent_id
        for (const evt of tokenEvents) {
            expect(evt.agent_id).toBeDefined();
        }

        // Specialist tokens are tagged with 'specialist'
        const specialistTokens = tokenEvents.filter(e => e.agent_id === 'specialist');
        expect(specialistTokens.length).toBeGreaterThan(0);
        expect(specialistTokens.some(e => e.content === 'specialist-token')).toBe(true);

        // Orchestrator final tokens are tagged with the orchestrator id
        const orchestratorTokens = tokenEvents.filter(e => e.agent_id === 'test-agent');
        expect(orchestratorTokens.length).toBeGreaterThan(0);
        expect(orchestratorTokens.some(e => e.content === 'orchestrator-final')).toBe(true);
    });
});

// ── MCP integration modes ─────────────────────────────────────────────────────

describe('AgentEngine — MCP mode=tools (default)', () => {
    function buildEngineWithMCPTools(assignTo?: string[]) {
        const provider = createTextProvider('done');
        const { agents, tools, providers } = buildRegistries(provider);
        const { transport, events } = createMockTransport();

        // A second agent that we can assign tools to
        const specialist: AgentProfile = {
            id: 'backend',
            name: 'Backend',
            icon: '⚙',
            description: 'Backend specialist',
            systemPrompt: 'You are a backend specialist.',
            allowedTools: ['local-tool'],
            delegatesTo: [],
        };
        agents.upsert(specialist);

        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock',
            transport,
            defaultAgentId: 'test-agent',
            maxIterations: 1,
        });

        // Simulate what ensureMCPInitialized does: call registerMCPAgent via the private path.
        // We test via the public surface: after registering, check allowedTools on agents.
        // Access private method via cast for testing purposes.
        const mcpTool: ToolDefinition = {
            name: 'mcp__github__get_issue',
            description: '[MCP:github] Get a GitHub issue by number',
            parameters: { type: 'object', properties: { number: { type: 'number' } }, required: ['number'] },
            execute: async () => 'issue content',
        };

        (engine as unknown as { registerMCPAgent: (c: unknown, t: unknown[]) => void })
            .registerMCPAgent(
                { name: 'github', mode: 'tools', assignTo },
                [mcpTool],
            );

        return { engine, agents, events };
    }

    it('does NOT create a wrapper agent entry in the roster', () => {
        const { agents } = buildEngineWithMCPTools(['backend']);
        expect(agents.has('github')).toBe(false);
    });

    it('assigns the MCP tool to the specified agent allowedTools', () => {
        const { agents } = buildEngineWithMCPTools(['backend']);
        const backend = agents.get('backend')!;
        expect(backend.allowedTools).toContain('mcp__github__get_issue');
    });

    it('preserves existing allowedTools when merging', () => {
        const { agents } = buildEngineWithMCPTools(['backend']);
        const backend = agents.get('backend')!;
        expect(backend.allowedTools).toContain('local-tool');
    });

    it('assigns to all agents when assignTo is omitted', () => {
        const { agents } = buildEngineWithMCPTools(undefined);
        // Both test-agent and backend should receive the tool
        const testAgent = agents.get('test-agent')!;
        const backend = agents.get('backend')!;
        expect(testAgent.allowedTools).toContain('mcp__github__get_issue');
        expect(backend.allowedTools).toContain('mcp__github__get_issue');
    });

    it('does not duplicate tools when the same server is re-registered (reconnect scenario)', () => {
        const { engine, agents } = buildEngineWithMCPTools(['backend']);
        const mcpTool: ToolDefinition = {
            name: 'mcp__github__get_issue',
            description: '[MCP:github] Get a GitHub issue by number',
            parameters: { type: 'object', properties: { number: { type: 'number' } }, required: ['number'] },
            execute: async () => 'issue content',
        };
        // Same server re-registered (simulates a reconnect) — allowedTools should still have it once
        (engine as unknown as { registerMCPAgent: (c: unknown, t: unknown[]) => void })
            .registerMCPAgent({ name: 'github', mode: 'tools', assignTo: ['backend'] }, [mcpTool]);

        const backend = agents.get('backend')!;
        const count = backend.allowedTools.filter(t => t === 'mcp__github__get_issue').length;
        expect(count).toBe(1);
    });
});

describe('AgentEngine — MCP mode=agent', () => {
    it('creates a wrapper agent in the roster', () => {
        const provider = createTextProvider('done');
        const { agents, tools, providers } = buildRegistries(provider);
        const { transport } = createMockTransport();

        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock',
            transport,
            defaultAgentId: 'test-agent',
            maxIterations: 1,
        });

        const mcpTool: ToolDefinition = {
            name: 'mcp__deep_research__search',
            description: '[MCP:deep-research] Search research papers',
            parameters: { type: 'object', properties: { query: { type: 'string' } } },
            execute: async () => 'results',
        };

        (engine as unknown as { registerMCPAgent: (c: unknown, t: unknown[]) => void })
            .registerMCPAgent(
                { name: 'deep-research', mode: 'agent', agentDescription: 'External research service with own reasoning' },
                [mcpTool],
            );

        expect(agents.has('deep-research')).toBe(true);
        const wrapper = agents.get('deep-research')!;
        expect(wrapper.source).toBe('mcp');
        expect(wrapper.allowedTools).toContain('mcp__deep_research__search');
    });
});
