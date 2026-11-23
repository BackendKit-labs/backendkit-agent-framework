/**
 * WHAT THE OPERATOR SETS UP, and the framework does not do for you: who the agents are (their keys), who may empower them (the issuer), who may
 * approve (the directory of people and roles) and which power each agent holds. In production those come from your identity system; here they are
 * made in memory so the example runs alone. Nothing here is part of the framework.
 */
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { ed25519AgentIdentities, type ApproverDirectory } from '@backendkit-labs/agent-core';
import { issueMandate } from '@backendkit-labs/agent-mandates';
import { ANALYST, EXECUTOR, ORCHESTRATOR, REBALANCER } from './agents';
import { CURRENCY } from './domain';

export const ISSUER = 'did:example:finance-department';
export const identityOf = (agentId: string) => `did:example:agent:${agentId}`;

/** The people, and what each one is. Roles come from here, never from what a caller says. */
export const PEOPLE: Record<string, { roles: string[] }> = {
    carlos: { roles: ['trader'] },      // asks for the rebalance
    ana: { roles: ['finance'] },        // may approve what is above the limit
    laura: { roles: ['finance'] },
    intern: { roles: ['intern'] },
};
export const directory: ApproverDirectory = { describe: (by) => PEOPLE[by.id] };

export interface Grant { actions: string[]; /** The most one order may be, in EUR. Absent: no limit on amount. */ maxAmount?: number }

/**
 * The power each agent holds, as the finance department grants it. The executor can trade up to 5,000 EUR an order; the analyst and the rebalancer only
 * read; the orchestrator can only hand work over (`ask_agent`): a delegation is a call like any other, so it needs a power too.
 */
export const GRANTS: Record<string, Grant> = {
    [ANALYST]: { actions: ['get_portfolio', 'get_signal'] },
    [REBALANCER]: { actions: ['get_portfolio', 'plan_rebalance'] },
    [EXECUTOR]: { actions: ['place_order'], maxAmount: 5_000 },
    [ORCHESTRATOR]: { actions: ['ask_agent'] },
};

export function buildOperator(options: { userId?: string; now?: () => number } = {}) {
    const userId = options.userId ?? 'carlos';
    const issuer = generateKeyPairSync('ed25519');
    const agentKeys: Record<string, { publicKey: KeyObject; privateKey: KeyObject }> = {};
    for (const id of [ANALYST, REBALANCER, EXECUTOR, ORCHESTRATOR]) agentKeys[id] = generateKeyPairSync('ed25519');

    const identities = ed25519AgentIdentities(Object.fromEntries(
        Object.entries(agentKeys).map(([id, k]) => [id, { id: identityOf(id), privateKey: k.privateKey }]),
    ));

    /** A credential tied to the key of `agentId` and to its identity, for the person `userId`. `over` overrides what to put in it, to build the bad ones. */
    function credentialFor(agentId: string, over: { forAgent?: string; /** `null`: no key at all, a bearer credential. */ holderKey?: KeyObject | null; maxAmount?: number } = {}): string {
        const grant = GRANTS[agentId];
        if (!grant) throw new Error(`no grant for "${agentId}"`);
        const max = over.maxAmount ?? grant.maxAmount;
        return issueMandate({
            privateKey: issuer.privateKey, alg: 'EdDSA', issuer: ISSUER, subject: userId, id: `m-${agentId}-${Math.random().toString(36).slice(2, 8)}`,
            agent: agentId, agentIdentity: identityOf(over.forAgent ?? agentId), ...(over.holderKey === null ? {} : { holderKey: over.holderKey ?? agentKeys[agentId]!.publicKey }),
            actions: grant.actions, ...(max !== undefined ? { limits: { amount: { max, currency: CURRENCY } } } : {}),
            expiresAt: Math.floor((options.now?.() ?? Date.now()) / 1000) + 3600,
        });
    }

    return {
        userId, identities, directory, agentKeys,
        trustedIssuers: { [ISSUER]: issuer.publicKey },
        credentialFor,
        /** The credentials every agent holds, by agent id. */
        credentials: (): Record<string, string> => ({ [ANALYST]: credentialFor(ANALYST), [REBALANCER]: credentialFor(REBALANCER), [EXECUTOR]: credentialFor(EXECUTOR), [ORCHESTRATOR]: credentialFor(ORCHESTRATOR) }),
        /** The keys that verify the signatures of the audit, from the operator and never from the log. */
        keyOf: (kid: string) => identities.publicKeyOf?.(kid),
    };
}
