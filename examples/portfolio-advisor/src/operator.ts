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

export interface Grant {
    actions: string[];
    /** The most one order may be, in EUR. Absent: no limit on amount. */
    maxAmount?: number;
    /** The most shares one order may move. A cap that is not money (SPEC-0045): the mandate carries it in its second profile. Absent: no cap on shares. */
    maxShares?: number;
}

/**
 * The power the finance department grants, and only to what is CRITICAL. An order cannot be undone, so the executor may send one alone up to 5,000 EUR
 * AND up to 100 shares; above either, a person of finance decides. The other agents hold no mandate at all: reading, planning and handing work over are
 * not critical, and the policy does not ask for a power there (`appliesTo`, see `advisor.ts`).
 */
export const GRANTS: Record<string, Grant> = {
    [EXECUTOR]: { actions: ['place_order'], maxAmount: 5_000, maxShares: 100 },
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
    function credentialFor(agentId: string, over: { forAgent?: string; /** `null`: no key at all, a bearer credential. */ holderKey?: KeyObject | null; maxAmount?: number; maxShares?: number } = {}): string {
        const grant = GRANTS[agentId];
        if (!grant) throw new Error(`no grant for "${agentId}"`);
        const max = over.maxAmount ?? grant.maxAmount;
        const maxShares = over.maxShares ?? grant.maxShares;
        return issueMandate({
            privateKey: issuer.privateKey, alg: 'EdDSA', issuer: ISSUER, subject: userId, id: `m-${agentId}-${Math.random().toString(36).slice(2, 8)}`,
            agent: agentId, agentIdentity: identityOf(over.forAgent ?? agentId), ...(over.holderKey === null ? {} : { holderKey: over.holderKey ?? agentKeys[agentId]!.publicKey }),
            actions: grant.actions,
            ...(max !== undefined || maxShares !== undefined
                ? { limits: { ...(max !== undefined ? { amount: { max, currency: CURRENCY } } : {}), ...(maxShares !== undefined ? { measures: [{ name: 'shares', max: maxShares, unit: 'shares' }] } : {}) } }
                : {}),
            expiresAt: Math.floor((options.now?.() ?? Date.now()) / 1000) + 3600,
        });
    }

    return {
        userId, identities, directory, agentKeys,
        trustedIssuers: { [ISSUER]: issuer.publicKey },
        credentialFor,
        /** The credentials the agents hold, by agent id: only the executor holds one. */
        credentials: (): Record<string, string> => ({ [EXECUTOR]: credentialFor(EXECUTOR) }),
        /** The keys that verify the signatures of the audit, from the operator and never from the log. */
        keyOf: (kid: string) => identities.publicKeyOf?.(kid),
    };
}
