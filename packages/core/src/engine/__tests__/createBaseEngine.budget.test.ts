import { createBaseEngine, type BaseEngineOptions } from '../createBaseEngine';
import type { AgentProfile, LLMProvider, ToolDefinition } from '../../types';
import type { BudgetUsage } from '../../observability/types';
import { createMockTransport, testAgent } from '../../__tests__/helpers';

/** SPEC-0001 §4 (ADR-0002): abortOnBudget, single-fire callback, warnings, sub-agents. */

const noop: ToolDefinition = {
    name: 'noop', description: 'noop', parameters: { type: 'object', properties: {} },
    execute: async () => 'ok',
};
const pricing = { inputPricePerMToken: 3, outputPricePerMToken: 15 };

/** Every call asks for the noop tool and reports 1M input tokens (3 USD at the test pricing). */
function spendingProvider(calls: { n: number }): LLMProvider {
    return {
        async chat(_m, _t, cb) {
            calls.n++;
            const id = `c${calls.n}`;
            cb.onToolCall?.('noop', '{}', id);
            cb.onMetrics?.(1_000_000, 0);
            cb.onDone({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'noop', arguments: '{}' } }] });
        },
    };
}

function build(extra: Partial<BaseEngineOptions>, provider: LLMProvider, agents: AgentProfile[] = [{ ...testAgent, allowedTools: ['noop'] }]) {
    const { transport, events } = createMockTransport();
    const engine = createBaseEngine({ requireAgentIdentity: false,
        providers: { mock: provider },
        defaultProvider: 'mock',
        agents,
        defaultAgent: agents[0].id,
        tools: [noop],
        transport,
        workingDir: process.cwd(),
       
        iterationMode: 'auto',
        maxIterations: 5,
        ...extra,
    });
    return { engine, events };
}

describe('abortOnBudget (ADR-0002)', () => {
    it('stops before the next iteration, emits budget_exceeded and calls the user callback once', async () => {
        const calls = { n: 0 };
        const seen: BudgetUsage[] = [];
        const { engine, events } = build({
            abortOnBudget: true,
            observability: { costTracker: { ...pricing, budget: { perRun: 0.01 }, onBudgetExceeded: u => seen.push(u) } },
        }, spendingProvider(calls));
        await engine.run('go');
        expect(calls.n).toBe(1);
        expect(seen).toHaveLength(1);
        expect(events.filter(e => e.type === 'budget_exceeded')).toHaveLength(1);
    });

    it('without abortOnBudget the run continues (callback still fires once)', async () => {
        const calls = { n: 0 };
        const seen: BudgetUsage[] = [];
        const { engine, events } = build({
            observability: { costTracker: { ...pricing, budget: { perRun: 0.01 }, onBudgetExceeded: u => seen.push(u) } },
        }, spendingProvider(calls));
        await engine.run('go');
        expect(calls.n).toBeGreaterThan(1);
        expect(seen).toHaveLength(1);
        expect(events.some(e => e.type === 'budget_exceeded')).toBe(false);
    });

    it('stops a running sub-agent too', async () => {
        const workerCalls = { n: 0 };
        let bossTurn = 0;
        const askArgs = '{"agent_id":"worker","question":"q"}';
        const boss: LLMProvider = {
            async chat(_m, _t, cb) {
                if (bossTurn++ === 0) {
                    cb.onToolCall?.('ask_agent', askArgs, 'a1');
                    cb.onDone({ role: 'assistant', content: null, tool_calls: [{ id: 'a1', type: 'function', function: { name: 'ask_agent', arguments: askArgs } }] });
                } else { cb.onChunk?.('done'); cb.onDone({ role: 'assistant', content: 'done' }); }
            },
        };
        const agents: AgentProfile[] = [
            { ...testAgent, id: 'boss', provider: 'boss', allowedTools: ['ask_agent'], delegatesTo: ['worker'] },
            { ...testAgent, id: 'worker', provider: 'worker', allowedTools: ['noop'] },
        ];
        const { transport } = createMockTransport();
        const engine = createBaseEngine({ requireAgentIdentity: false,
            providers: { mock: boss, boss, worker: spendingProvider(workerCalls) },
            defaultProvider: 'mock', agents, defaultAgent: 'boss', tools: [noop], transport,
            workingDir: process.cwd(), iterationMode: 'auto', maxIterations: 5,
            abortOnBudget: true,
            observability: { costTracker: { ...pricing, budget: { perRun: 0.01 } } },
        });
        await engine.run('go');
        expect(workerCalls.n).toBe(1);
    });
});

describe('budget configuration warnings (ADR-0002)', () => {
    const idle: LLMProvider = { async chat(_m, _t, cb) { cb.onDone({ role: 'assistant', content: 'x' }); } };
    const warns = (events: Array<{ type: string }>) =>
        events.filter((e): e is { type: 'system'; level: 'warn'; text: string } =>
            e.type === 'system' && (e as { level?: string }).level === 'warn');

    it('warns when a budget has no prices', () => {
        const { events } = build({ observability: { costTracker: { budget: { perRun: 1 } } } }, idle);
        expect(warns(events).some(w => /no token prices/.test(w.text))).toBe(true);
    });

    it('does not warn about prices when they are configured', () => {
        const { events } = build({ observability: { costTracker: { ...pricing, budget: { perRun: 1 } } } }, idle);
        expect(warns(events)).toHaveLength(0);
    });

    it('warns that perDay is not persisted', () => {
        const { events } = build({ observability: { costTracker: { ...pricing, budget: { perDay: 5 } } } }, idle);
        expect(warns(events).some(w => /perDay/.test(w.text))).toBe(true);
    });
});
