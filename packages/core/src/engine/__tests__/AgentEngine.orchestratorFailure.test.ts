import { AgentEngine } from '../AgentEngine';
import type { LLMProvider } from '../../types';
import type { Orchestrator } from '../../orchestration/orchestrator';
import { codingPipelineHooks } from '../coding-pipeline-hooks';
import { buildRegistries, createMockTransport, testAgent } from '../../__tests__/helpers';

const failing = { orchestrate: async () => { throw new Error('classifier down'); } } as unknown as Orchestrator;

function build(mode?: 'closed' | 'open') {
    let chats = 0;
    const provider: LLMProvider = {
        async chat(_m, _t, cb) { chats++; cb.onChunk?.('ok'); cb.onDone({ role: 'assistant', content: 'ok' }); },
    };
    const { agents, tools, providers } = buildRegistries(provider, testAgent);
    const { transport, events } = createMockTransport();
    const engine = new AgentEngine({
        model: { provider: 'mock', id: 'mock' }, agents, tools, providers, defaultProvider: 'mock', transport,
        defaultAgentId: testAgent.id, iterationMode: 'auto', maxIterations: 2,
        hooks: [codingPipelineHooks({ orchestrator: failing, failureMode: mode })],
    });
    return { engine, events, chats: () => chats };
}

describe('AgentEngine — orchestrator failure', () => {
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
