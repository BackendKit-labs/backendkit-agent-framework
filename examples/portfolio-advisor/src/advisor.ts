import type { KeyObject } from 'node:crypto';
import {
    HashChainAuditSink, createBaseEngine, mandatePolicy,
    type AgentIdentityProvider, type AgentProfile, type Approver, type ApproverDirectory, type LLMProvider, type MCPServerConfig, type Transport,
} from '@backendkit-labs/agent-core';
import { jwtMandateVerifier } from '@backendkit-labs/agent-mandates';
import { ANALYST, ORCHESTRATOR, profiles } from './agents';
import { CURRENCY, type SimulatedBroker, type Targets } from './domain';
import { SIGNALS_SERVER } from './signals-server';
import { buildTools } from './tools';

export interface AdvisorOptions {
    provider: LLMProvider;
    transport: Transport;
    /** The person the agents act for: the one who asked. The mandates have to empower this person. */
    userId: string;
    broker: SimulatedBroker;
    targets: Targets;
    /** Who each agent is, and what signs for it. */
    identities: AgentIdentityProvider;
    /** The credential each agent holds, by agent id. An agent with none holds no power. */
    credentials: Record<string, string | undefined>;
    /** The issuers of credentials you trust, with their keys. */
    trustedIssuers: Record<string, KeyObject>;
    /** Who the people are and what roles they have. */
    directory: ApproverDirectory;
    /** Who answers when an order is above what the agent may do alone. */
    approver: Approver;
    auditLogPath: string;
    /** Default true: a credential not tied to the key of the agent (a bearer one) is refused. */
    requireHolderBinding?: boolean;
    /**
     * The signals server (`startSignalsServer`): the analyst reads the signals THERE instead of from a tool of its own. `trust` says whether the
     * client believes the server when it declares a tool read-only (`trustAnnotations`); by default it does not, and a call to it asks a person.
     */
    signals?: { url: string; token?: string; trust?: boolean };
    /** Replace the agents (tests add one that should not be able to trade). */
    agents?: AgentProfile[];
}

/**
 * The whole advisor. Everything that governs it is framework: the identity of each agent and the signature of its audit events
 * (`agentIdentity`), the power each one holds (`mandatePolicy` with the reference verifier of `agent-mandates`), what happens outside that power
 * (`approver`, `approverDirectory`, `forbidSelfApproval`) and who hands work to whom (`delegatesTo`).
 */
export function createAdvisor(options: AdvisorOptions) {
    const audit = new HashChainAuditSink(options.auditLogPath);

    const policy = mandatePolicy({
        verifier: jwtMandateVerifier({
            trustedIssuers: options.trustedIssuers,
            credentialFor: (request) => options.credentials[request.principal.agentId],
        }),
        // The mandate is for what is critical: an order. Reading, planning and delegating are decided by the framework's own policy (a read runs).
        appliesTo: (tool) => tool.destructive === true,
        // A cap that is not money: how many shares an order moves, read from the call.
        measureOf: { shares: (args) => (typeof args.quantity === 'number' ? { value: args.quantity, unit: 'shares' } : undefined) },
        // What an order spends is read from its arguments. A tool that does not say it spends nothing is never limited by the amount.
        amountOf: (args) => (typeof args.amount === 'number' ? { value: args.amount, currency: typeof args.currency === 'string' ? args.currency : CURRENCY } : undefined),
        agentIdentity: options.identities,
        requireHolderBinding: options.requireHolderBinding ?? true,
        // Above the limit a person decides, and it has to be someone of finance: the engine checks the role in the directory.
        outOfScope: 'ask',
        outOfScopeApprover: { approverRoles: ['finance'] },
    });

    const engine = createBaseEngine({
        providers: { mock: options.provider }, defaultProvider: 'mock',
        agents: options.agents ?? profiles, defaultAgent: ORCHESTRATOR,
        tools: buildTools(options.broker, options.targets, { signalsFromServer: options.signals !== undefined }),
        ...(options.signals ? { mcpServers: [signalsServer(options.signals)] } : {}),
        transport: options.transport, workingDir: process.cwd(), iterationMode: 'auto',
        agentIdentity: options.identities, identity: { userId: options.userId },
        audit, policy,
        approver: options.approver, approverDirectory: options.directory, forbidSelfApproval: true,
    });

    return { engine, audit };
}

/** The signals server as the engine connects to it: its tool goes to the analyst only, and the others never see it. */
function signalsServer(signals: NonNullable<AdvisorOptions['signals']>): MCPServerConfig {
    return {
        name: SIGNALS_SERVER, url: signals.url, remoteTransport: 'streamable-http', mode: 'tools', assignTo: [ANALYST],
        ...(signals.token ? { headers: { Authorization: `Bearer ${signals.token}` } } : {}),
        ...(signals.trust ? { trustAnnotations: true } : {}),
    };
}
