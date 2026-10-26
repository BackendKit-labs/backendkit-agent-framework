import { AgentEngine } from '../AgentEngine';
import type { AgentProfile, LLMProvider } from '../../types';
import { buildRegistries, createMockTransport, testAgent } from '../../__tests__/helpers';

describe('AgentEngine — abort() reaches a sub-agent mid-call', () => {
    it('aborts the sub-agent LLM call instead of letting it run to completion', async () => {
        let specialistSignal: AbortSignal | undefined;
        let specialistFinished = false;

        const orchestratorProvider: LLMProvider = {
            async chat(_m, _t, cb) {
                const id = 'c1';
                const args = JSON.stringify({ agent_id: 'slow', question: 'q' });
                cb.onToolCall?.('ask_agent', args, id);
                cb.onDone({
                    role: 'assistant', content: null,
                    tool_calls: [{ id, type: 'function', function: { name: 'ask_agent', arguments: args } }],
                });
            },
        };
        const specialistProvider: LLMProvider = {
            // Stands in for a slow model call: it only ends when its signal fires (or after 5 s).
            chat: (_m, _t, cb) => new Promise<void>((resolve) => {
                specialistSignal = cb.signal;
                const t = setTimeout(() => { specialistFinished = true; cb.onDone({ role: 'assistant', content: 'late' }); resolve(); }, 5_000);
                cb.signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
            }),
        };

        const orchestrator: AgentProfile = { ...testAgent, delegatesTo: ['slow'] };
        const { agents, tools, providers } = buildRegistries(orchestratorProvider, orchestrator);
        agents.upsert({ id: 'slow', name: 'slow', icon: '🐢', description: 's', systemPrompt: '', allowedTools: [], delegatesTo: [], provider: 'slow' });
        providers.register('slow', specialistProvider);

        const { transport } = createMockTransport();
        const engine = new AgentEngine({
            model: { provider: 'mock', id: 'mock' }, agents, tools, providers,
            defaultProvider: 'mock', transport, defaultAgentId: testAgent.id, iterationMode: 'auto', maxIterations: 5,
        });

        const started = Date.now();
        const run = engine.run('delegate');
        await new Promise(r => setTimeout(r, 100));
        expect(specialistSignal).toBeDefined();
        expect(specialistSignal!.aborted).toBe(false);

        engine.abort();
        await run;

        expect(specialistSignal!.aborted).toBe(true);
        expect(specialistFinished).toBe(false);
        expect(Date.now() - started).toBeLessThan(2_000);
    });
});
