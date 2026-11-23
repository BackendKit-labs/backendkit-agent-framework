import { AgentEngine, AgentRegistry, ToolRegistry, ProviderRegistry, type AgentProfile, type LLMProvider, type Transport } from '@backendkit-labs/agent-core';
import { codingPipelineHooks } from '../coding-pipeline-hooks';

const testAgent: AgentProfile = {
    id: 'test-agent', name: 'Test Agent', icon: '🤖', description: 'test',
    systemPrompt: 'You are a test agent.', allowedTools: [], delegatesTo: [],
};

function buildRegistries(provider: LLMProvider) {
    const agents = new AgentRegistry(); agents.upsert(testAgent);
    const providers = new ProviderRegistry(); providers.register('mock', provider);
    return { agents, tools: new ToolRegistry(), providers };
}

function createMockTransport(): { transport: Transport } {
    return { transport: { emit: () => undefined, onInput: () => () => undefined, close: () => undefined } };
}

// ── Orchestration brief injection ─────────────────────────────────────────────

describe('AgentEngine — orchestration brief in system prompt', () => {
    /**
     * Creates a mock Orchestrator that returns a fixed OrchestrationResult.
     * The mock is minimal — only the orchestrate() method is needed.
     */
    function makeMockOrchestrator(result: import('../orchestration/types').OrchestrationResult) {
        return { orchestrate: async () => result } as unknown as import('../orchestration/orchestrator').Orchestrator;
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

        const orchResult: import('../orchestration/types').OrchestrationResult = {
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
                customGates: {},
                completedCustomGates: [],
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

        const engine = new AgentEngine({ requireAgentIdentity: false,
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock',
            transport,
            defaultAgentId: 'test-agent',
            maxIterations: 1,
            hooks: [codingPipelineHooks({ orchestrator: makeMockOrchestrator(orchResult), defaultAgentId: 'test-agent' })],
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

        const engine = new AgentEngine({ requireAgentIdentity: false,
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

        const orchResult: import('../orchestration/types').OrchestrationResult = {
            task: {
                taskId: 't2', rawPrompt: 'hello', actionType: 'unknown', domains: [],
                riskLevel: 'low',
                riskFactors: { breaking_change: false, security_sensitive: false, cross_service_impact: false, db_transactional: false, production_critical: false, complexity: 1 },
                requiresQaApproval: false, requiresSecurityReview: false, requiresArchitectureReview: false,
                customGates: {}, completedCustomGates: [],
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

        const engine = new AgentEngine({ requireAgentIdentity: false,
            model: { provider: 'mock', id: 'mock' },
            agents, tools, providers,
            defaultProvider: 'mock',
            transport,
            defaultAgentId: 'test-agent',
            maxIterations: 1,
            hooks: [codingPipelineHooks({ orchestrator: makeMockOrchestrator(orchResult), defaultAgentId: 'test-agent' })],
        });

        await engine.run('hello');
        // Brief header still present (it always renders task metadata),
        // but no recommended-agents section since it's just the fallback
        const systemPrompt = captured[0];
        expect(systemPrompt).toContain('Orchestrator Analysis');
        expect(systemPrompt).not.toContain('Recommended agents');
    });
});
