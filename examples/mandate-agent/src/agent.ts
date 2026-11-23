/**
 * A purchasing agent that acts under a power of representation. Inside the limits of its mandate it buys alone; outside them it asks
 * a person; with no valid mandate it does nothing. Every call lands in a hash-chained audit log, with the mandate it ran under, and
 * the head of the chain is signed.
 *
 * The credential comes from `dalion-assumed.ts` (an ASSUMED format, see there). Swap that one adapter for the real one when it exists:
 * nothing in this file knows how a credential looks.
 *
 * The credential says WHAT may be done (`buy`), ON WHAT (`television`) and up to HOW MUCH, never which tool runs it. The link between the
 * two is made HERE: each tool declares the verb it performs in its own `meta.capability`, and `objectOf` reads what a call is about.
 */
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import {
    createBaseEngine, defaultToolPolicy, defineTool, ed25519Signer, HashChainAuditSink, mandatePolicy, z,
    type AgentProfile, type Approver, type ToolPolicy, type ApprovalOutcome, type ApprovalRequest, type LLMProvider, type MandateRequest, type Transport,
} from '@backendkit-labs/agent-core';
import { CAPABILITY_META_KEY, dalionMandateVerifier } from './dalion-assumed';

export const AGENT_ID = 'buyer';
/** The non-human identity DALION gave this agent (assumed shape). */
export const AGENT_DALION_IDENTITY = 'did:dalion:agent:buyer-01';

export interface Purchase { item: string; amount: number; currency: string }

export interface BuyerAgentOptions {
    provider: LLMProvider;
    transport: Transport;
    /** For whom the agent acts. The mandate must empower this person. */
    userId: string;
    /** The credential this agent holds. A function, so a test can change it between runs. */
    credential: () => string | undefined;
    /** DALION issuers you trust, with their public keys. */
    trustedIssuers: Record<string, KeyObject>;
    isRevoked?: (s: { credentialId: string; statusId: string | undefined }) => boolean | Promise<boolean>;
    /** Who answers when the mandate does not cover a call. Default: nobody (rejects everything). */
    approver?: Approver;
    /**
     * The verb `buy_supplies` declares in its metadata, in the credential's vocabulary. Default `buy`. `null`: the tool declares none and is
     * never covered by a mandate. Renaming the tool or changing its verb never touches the credential.
     */
    buyVerb?: string | null;
    auditLogPath: string;
    checkpointsPath: string;
    now?: () => Date;
}

const buyerProfile: AgentProfile = {
    id: AGENT_ID,
    name: 'Buyer',
    icon: '🛒',
    description: 'Buys supplies for the person it works for, within its mandate',
    systemPrompt: 'You buy supplies. Check a price before you buy. Never try to work around a refusal: report it.',
    allowedTools: ['check_price', 'buy_supplies', 'sign_contract'],
};

/** What a call is about: the object a power may name (`television`). `undefined` when the call does not say. */
const objectOf = (args: Record<string, unknown>) => (typeof args.item === 'string' && args.item.length > 0 ? args.item : undefined);

/** What a call spends, read from its arguments. `undefined` when the call does not say: the policy then refuses to treat it as covered. */
const amountOf = (args: Record<string, unknown>) =>
    typeof args.amount === 'number' && typeof args.currency === 'string' ? { value: args.amount, currency: args.currency } : undefined;

export function buildBuyerAgent(options: BuyerAgentOptions) {
    const purchases: Purchase[] = [];
    const contracts: string[] = [];

    const checkPrice = defineTool({
        name: 'check_price',
        description: 'Look up the price of an item',
        readOnly: true,
        input: z.object({ item: z.string() }),
        execute: async ({ item }) => `${item}: 120 EUR`,
    });
    const buy = defineTool({
        name: 'buy_supplies',
        description: 'Buy an item. Irreversible',
        destructive: true,
        meta: options.buyVerb === null ? {} : { [CAPABILITY_META_KEY]: options.buyVerb ?? 'buy' },
        input: z.object({ item: z.string(), amount: z.number(), currency: z.string() }),
        execute: async ({ item, amount, currency }) => { purchases.push({ item, amount, currency }); return `bought ${item} for ${amount} ${currency}`; },
    });
    const sign = defineTool({
        name: 'sign_contract',
        description: 'Sign a contract in the name of the person. Irreversible',
        destructive: true,
        meta: { [CAPABILITY_META_KEY]: 'sign' },
        input: z.object({ contract: z.string() }),
        execute: async ({ contract }) => { contracts.push(contract); return `signed ${contract}`; },
    });

    const signingKey = generateKeyPairSync('ed25519');
    const audit = new HashChainAuditSink(options.auditLogPath, {
        checkpoints: { signer: ed25519Signer(signingKey.privateKey, 'audit-key-1'), path: options.checkpointsPath, every: 1 },
    });

    const approvals: ApprovalRequest[] = [];
    const approver: Approver = options.approver ?? {
        ref: { kind: 'human', id: 'nobody' },
        request: async (): Promise<ApprovalOutcome> => ({ decision: 'reject', by: { kind: 'human', id: 'nobody' }, reason: 'no approver configured', at: new Date().toISOString() }),
    };
    const recordingApprover: Approver = {
        ref: approver.ref,
        request: async (req) => { approvals.push(req); return approver.request(req); },
    };

    const verifier = dalionMandateVerifier({
        trustedIssuers: options.trustedIssuers,
        credentialFor: (_: MandateRequest) => options.credential(),
        agentIdentityOf: (agentId) => (agentId === AGENT_ID ? AGENT_DALION_IDENTITY : undefined),
        objectOf,
        ...(options.isRevoked ? { isRevoked: options.isRevoked } : {}),
        ...(options.now ? { now: options.now } : {}),
    });

    const governed = mandatePolicy({ verifier, amountOf, resourceOf: objectOf, outOfScope: 'ask', ...(options.now ? { now: options.now } : {}) });
    // Looking something up changes nothing and is not something a person empowers: only what acts needs a mandate. The framework's own
    // rule for read-only tools decides those. `defaultToolPolicy` cannot be listed next to `mandatePolicy` (it asks for every destructive
    // tool, and an `ask` beats an `allow`, which would cancel the mandate), so the split is by the tool's declared `readOnly`.
    const policy: ToolPolicy = {
        decide: (principal, call) => (call.tool.readOnly ? defaultToolPolicy.decide(principal, call) : governed.decide(principal, call)),
    };

    const engine = createBaseEngine({
        providers: { mock: options.provider }, defaultProvider: 'mock', agents: [buyerProfile], defaultAgent: AGENT_ID,
        tools: [checkPrice, buy, sign], transport: options.transport, workingDir: process.cwd(), iterationMode: 'auto',
        identity: { userId: options.userId },
        audit,
        policy,
        approver: recordingApprover,
    });

    return { engine, audit, purchases, contracts, approvals };
}
