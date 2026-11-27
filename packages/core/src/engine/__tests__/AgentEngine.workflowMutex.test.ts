/** Audit 2026-11-26, B-10: runWorkflow shares the engine's state with run(), so it must hold the engine like a turn. */
import { AgentEngine } from '../AgentEngine';
import type { LLMProvider } from '../../types';
import { buildRegistries, createMockTransport, testAgent } from '../../__tests__/helpers';

describe('runWorkflow waits for the turn in progress (B-10)', () => {
    it('a workflow started during a turn begins only when the turn has ended', async () => {
        const order: string[] = [];
        let releaseTurn!: () => void;
        const turnGate = new Promise<void>(r => { releaseTurn = r; });
        let calls = 0;
        const provider: LLMProvider = {
            async chat(_m, _t, cb) {
                calls++;
                if (calls === 1) { order.push('turn:start'); await turnGate; order.push('turn:end'); }
                else order.push('workflow:step');
                cb.onDone({ role: 'assistant', content: 'ok' });
            },
        };
        const { agents, tools, providers } = buildRegistries(provider);
        const { transport } = createMockTransport();
        const engine = new AgentEngine({
            requireAgentIdentity: false, model: { provider: 'mock', id: 'mock' }, agents, tools, providers,
            defaultProvider: 'mock', transport, defaultAgentId: testAgent.id, iterationMode: 'auto', maxIterations: 2,
        });

        const turn = engine.run('hello');
        await new Promise(r => setTimeout(r, 30));
        const workflow = engine.runWorkflow({ name: 'w', steps: [{ id: 's', agentId: testAgent.id, input: 'do', dependsOn: [] }] } as never);
        await new Promise(r => setTimeout(r, 30));
        expect(order).toEqual(['turn:start']);          // the workflow has not touched the engine yet
        releaseTurn();
        await Promise.all([turn, workflow]);
        expect(order).toEqual(['turn:start', 'turn:end', 'workflow:step']);
    });
});
