import { AgentEngine } from '../AgentEngine';
import type { AgentProfile, LLMProvider } from '../../types';
import { buildRegistries, createMockTransport, createScriptedProvider, testAgent } from '../../__tests__/helpers';

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
        const engine = new AgentEngine({ requireAgentIdentity: false,
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

    it('does not start the tool calls of the sub-agent that come after an abort', async () => {
        const ran: string[] = [];
        let engine!: AgentEngine;
        const orchestratorProvider = createScriptedProvider([
            { tool_calls: [{ id: 'c1', name: 'ask_agent', args: { agent_id: 'worker', question: 'q' } }] },
            { content: 'done' },
        ]);
        const workerProvider = createScriptedProvider([
            { tool_calls: [{ id: 'w1', name: 'first', args: {} }, { id: 'w2', name: 'second', args: {} }] },
            { content: 'ok' },
        ]);

        const orchestrator: AgentProfile = { ...testAgent, delegatesTo: ['worker'] };
        const { agents, tools, providers } = buildRegistries(orchestratorProvider, orchestrator);
        agents.upsert({ id: 'worker', name: 'worker', icon: '·', description: 'w', systemPrompt: '', allowedTools: ['first', 'second'], delegatesTo: [], provider: 'worker' });
        providers.register('worker', workerProvider);
        const params = { type: 'object', properties: {} };
        tools.register({ name: 'first', description: 'aborts the run', parameters: params, execute: async () => { ran.push('first'); engine.abort(); return 'aborted it'; } });
        tools.register({ name: 'second', description: 'must not run', parameters: params, execute: async () => { ran.push('second'); return 'ran'; } });

        const { transport } = createMockTransport();
        engine = new AgentEngine({ requireAgentIdentity: false,
            model: { provider: 'mock', id: 'mock' }, agents, tools, providers,
            defaultProvider: 'mock', transport, defaultAgentId: testAgent.id, iterationMode: 'auto', maxIterations: 5,
        });
        await engine.run('delegate');

        expect(ran).toEqual(['first']);
    });
});
