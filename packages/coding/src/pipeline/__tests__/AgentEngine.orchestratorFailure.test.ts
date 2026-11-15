import { AgentEngine, AgentRegistry, ToolRegistry, ProviderRegistry, type AgentEvent, type AgentProfile, type LLMProvider, type Transport } from '@backendkit-labs/agent-core';
import type { Orchestrator } from '../orchestration/orchestrator';
import { codingPipelineHooks } from '../coding-pipeline-hooks';

const failing = { orchestrate: async () => { throw new Error('classifier down'); } } as unknown as Orchestrator;

const agent: AgentProfile = {
    id: 'test-agent', name: 'Test Agent', icon: '🤖', description: 'test',
    systemPrompt: 'You are a test agent.', allowedTools: [], delegatesTo: [],
};

function build(mode?: 'closed' | 'open') {
    let chats = 0;
    const provider: LLMProvider = {
        async chat(_m, _t, cb) { chats++; cb.onChunk?.('ok'); cb.onDone({ role: 'assistant', content: 'ok' }); },
    };
    const agents = new AgentRegistry(); agents.upsert(agent);
    const providers = new ProviderRegistry(); providers.register('mock', provider);
    const events: AgentEvent[] = [];
    const transport: Transport = { emit: (e) => { events.push(e); }, onInput: () => () => undefined, close: () => undefined };
    const engine = new AgentEngine({
        model: { provider: 'mock', id: 'mock' }, agents, tools: new ToolRegistry(), providers, defaultProvider: 'mock', transport,
        defaultAgentId: agent.id, iterationMode: 'auto', maxIterations: 2,
        hooks: [codingPipelineHooks({ orchestrator: failing, failureMode: mode })],
    });
    return { engine, events, chats: () => chats };
}

describe('AgentEngine + codingPipelineHooks — orchestrator failure', () => {
    it('fails closed by default: the run does not start without the gates', async () => {
        const { engine, chats } = build();
        await expect(engine.run('do it')).rejects.toThrow(/refusing to run without its gates: classifier down/);
        expect(chats()).toBe(0);
    });

    it("'open' warns on the transport and runs anyway", async () => {
        const { engine, events, chats } = build('open');
        await engine.run('do it');
        expect(chats()).toBe(1);
        const warn = events.find(e => e.type === 'system' && (e as { level?: string }).level === 'warn');
        expect(JSON.stringify(warn)).toContain('classifier down');
    });
});
