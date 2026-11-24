import { AgentServer } from '@backendkit-labs/agent-protocol';
import { capabilityIdentityGate, type AgentIdentityProvider, type AuditSink } from '@backendkit-labs/agent-core';
import { planRebalance, type SimulatedBroker, type Targets } from './domain';
import type { createAdvisor } from './advisor';

/** The name the service announces, and so the agent whose identity signs the audit of every run. */
export const SERVICE = 'advisor-service';
/** The header the caller sends its personal token in. The shared `apiKey` of the protocol only says "a caller we know"; this says WHO. */
export const USER_TOKEN_HEADER = 'x-user-token';

export interface AdvisorServiceOptions {
    port: number;
    /** The shared key of the protocol (header `Authorization`). */
    apiKey: string;
    /** Who each personal token is. The person a run is FOR comes from here, never from a header the caller sets by itself (as `x-tenant-id`). */
    tokens: Record<string, string>;
    /** The identity of the service: it is the one that signs the audit of what it runs. */
    identities: AgentIdentityProvider;
    /** Where the service writes the audit of each run it was asked for (apart from the audit of the advisor behind it). */
    auditSink?: AuditSink;
    broker: SimulatedBroker;
    targets: Targets;
    /** Builds the advisor for ONE person: its mandates have to empower them. */
    advisorFor: (userId: string) => Pick<ReturnType<typeof createAdvisor>, 'engine'>;
}

/**
 * The advisor offered over the agent protocol: two capabilities. `plan_rebalance` only computes and answers at once; `rebalance` runs the whole advisor
 * for the person who asked and answers later (async). Both go behind an identity gate: the framework refuses a run with no identity for the service
 * or no person to act for, signs the audit, and gives the handler the person it acts for. The service does not trade by itself: an order is still
 * decided by the mandate and the approvals of the advisor behind it, with the person of the token as the one who asked.
 */
export function buildAdvisorService(options: AdvisorServiceOptions): AgentServer {
    const server = new AgentServer({
        name: SERVICE, version: '0.1.0', description: 'Portfolio advisor', port: options.port, apiKey: options.apiKey, strict: true,
        gate: capabilityIdentityGate({
            name: SERVICE, agentIdentity: options.identities,
            identity: (call) => {
                const raw = call.headers[USER_TOKEN_HEADER];
                const userId = typeof raw === 'string' ? options.tokens[raw] : undefined;
                if (!userId) throw new Error(`no valid "${USER_TOKEN_HEADER}": the run needs a person to act for`);
                return { userId };
            },
            ...(options.auditSink ? { auditSink: options.auditSink } : {}),
        }),
    });

    server.register({
        definition: {
            name: 'plan_rebalance', description: 'The orders that bring the portfolio back to its target allocation. It only computes them: nothing is sent', async: false,
            input: {}, output: { orders: { type: 'array' } },
        },
        execute: async () => ({ orders: planRebalance(options.broker, options.targets) }),
    });

    server.register({
        definition: {
            name: 'rebalance', description: 'Rebalances the portfolio for the person of the token: orders above their power wait for a person of finance', async: true,
            input: {}, output: { answer: { type: 'string' }, executed: { type: 'number' } },
        },
        execute: async (_input, context) => {
            if (!context.userId) throw new Error('no person to act for');          // the gate guarantees it; a handler does not rely on it silently
            const { engine } = options.advisorFor(context.userId);
            const result = await engine.run('rebalance my portfolio');
            return { answer: result.text, executed: options.broker.executed.length };
        },
    });

    return server;
}
