import type { AgentProfile } from '@backendkit-labs/agent-core';

/** The ids of the agents. Each one is its own identity (see `operator.ts`): who acted is never "the advisor", it is one of these four. */
export const ANALYST = 'analyst';
export const REBALANCER = 'rebalancer';
export const EXECUTOR = 'executor';
export const ORCHESTRATOR = 'orchestrator';

/**
 * The four agents of the design's phase 3 that this example builds (the design also has a market analyzer, a news researcher and a smart money
 * tracker; the signals of those are the fixed ones in `domain.ts`). Each agent lists the tools it may use; that is a fact of the profile, and the
 * mandate says what each may DO with them.
 */
export const profiles: AgentProfile[] = [
    {
        id: ANALYST, name: 'Analyst', icon: '📈', description: 'Reads the portfolio and the fused signals and says what to consider',
        systemPrompt: 'You analyse positions. Read the portfolio and the signal of each symbol, and report what the recommendation is. You never trade.',
        allowedTools: ['get_portfolio', 'get_signal'],
    },
    {
        id: REBALANCER, name: 'Rebalancer', icon: '⚖️', description: 'Computes the orders that bring the portfolio to its target',
        systemPrompt: 'You compute the orders that restore the target allocation. You report them; you never send them.',
        allowedTools: ['get_portfolio', 'plan_rebalance'],
    },
    {
        id: EXECUTOR, name: 'Executor', icon: '🧾', description: 'Sends orders to the broker',
        systemPrompt: 'You send the orders you are given, exactly as given. If one is refused, report it: never try another way.',
        allowedTools: ['place_order'],
    },
    {
        id: ORCHESTRATOR, name: 'Orchestrator', icon: '🧭', description: 'Routes each request to the right specialist',
        systemPrompt: 'Route each request to the right specialist with ask_agent, then answer the person with what they said.',
        allowedTools: [],
        delegatesTo: [ANALYST, REBALANCER, EXECUTOR],
    },
];
