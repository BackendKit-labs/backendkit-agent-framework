import { defineTool, z, type ToolDefinition } from '@backendkit-labs/agent-core';
import { CURRENCY, SIGNALS, fuse, planRebalance, recommend, type SimulatedBroker, type Targets } from './domain';

/**
 * The tools of the advisor. Each one DECLARES what it is (`readOnly`, `destructive`) and the framework decides what to do with that: a read runs,
 * an order is checked against the mandate and, outside it, asked to a person. None of them checks a limit or a role: that is not the tool's job.
 */
export function buildTools(broker: SimulatedBroker, targets: Targets, options: { signalsFromServer?: boolean } = {}): ToolDefinition[] {
    const getPortfolio = defineTool({
        name: 'get_portfolio',
        description: 'The cash, the holdings and the share of each one in the total value',
        readOnly: true,
        input: z.object({}),
        execute: async () => JSON.stringify({ currency: CURRENCY, cash: broker.cash, value: broker.value(), allocation: broker.allocation() }),
    });

    const getSignal = defineTool({
        name: 'get_signal',
        description: 'The fused signal of a symbol (news, institutional holdings and technical) and what it recommends given the share it has in the portfolio',
        readOnly: true,
        input: z.object({ symbol: z.string() }),
        execute: async ({ symbol }) => {
            const signals = SIGNALS[symbol];
            if (!signals) throw new Error(`no signals for "${symbol}"`);
            const fused = fuse(signals);
            return JSON.stringify({ symbol, ...fused, recommendation: recommend(fused, broker.allocation()[symbol] ?? 0) });
        },
    });

    const planRebalanceTool = defineTool({
        name: 'plan_rebalance',
        description: 'The orders that bring the portfolio back to its target allocation. It only computes them: nothing is sent',
        readOnly: true,
        input: z.object({}),
        execute: async () => JSON.stringify(planRebalance(broker, targets)),
    });

    const placeOrder = defineTool({
        name: 'place_order',
        description: 'Send an order to the broker. It cannot be undone',
        destructive: true,
        input: z.object({ symbol: z.string(), side: z.enum(['buy', 'sell']), quantity: z.number(), amount: z.number(), currency: z.string() }),
        execute: async (order) => { broker.place(order); return `${order.side} ${order.quantity} ${order.symbol} for ${order.amount} ${order.currency}: done`; },
    });

    // With the signals server (signals-server.ts) the analyst reads them there, and this local copy is not offered.
    return [getPortfolio, ...(options.signalsFromServer ? [] : [getSignal]), planRebalanceTool, placeOrder];
}
