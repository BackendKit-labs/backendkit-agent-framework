import { generateKeyPairSync } from 'node:crypto';
import {
    defineTool, ed25519AgentIdentities, startToolServerHttp, z,
    type AgentIdentityProvider, type AuditSink, type RunningToolServer,
} from '@backendkit-labs/agent-core';
import { SIGNALS, fuse, recommend } from './domain';

/** The name the server announces, and so the id it acts under in its own audit. The tool the advisor sees is `mcp__signals__get_signal`. */
export const SIGNALS_SERVER = 'signals';

export interface SignalsServerOptions {
    /** The token a client must send. Without it only loopback is accepted, which is what a test wants. */
    authToken?: string;
    /** Whom the server acts for (the principal of its audit). Default 'market-data'. */
    actsFor?: string;
    /** Where the server writes ITS audit: it is another process in production, with its own log and its own identity. */
    auditSink?: AuditSink;
    /** The identity of the server. Default: a key generated now (in production, the one your identity system gives it). */
    agentIdentity?: AgentIdentityProvider;
}

/**
 * The smart money signals as an MCP server: what a data team would run apart from the advisor, and the advisor would only CONSUME. It uses the
 * framework on the other side too: `startToolServerHttp` serves the tool, and the server has its own digital identity (every call it answers is in
 * its own audit, signed) and says for whom it acts. The tool declares `readOnly`, which a client believes only if it trusts the server
 * (`trustAnnotations`).
 */
export async function startSignalsServer(options: SignalsServerOptions = {}): Promise<RunningToolServer> {
    const getSignal = defineTool({
        name: 'get_signal',
        description: 'The fused signal of a symbol (news, institutional holdings and technical) and what it recommends given the share the symbol has in the portfolio',
        readOnly: true,
        input: z.object({ symbol: z.string(), allocation: z.number().min(0).max(1).optional().describe('The share of the symbol in the portfolio, 0 to 1. Default 0') }),
        execute: async ({ symbol, allocation }) => {
            const signals = SIGNALS[symbol];
            if (!signals) throw new Error(`no signals for "${symbol}"`);
            const fused = fuse(signals);
            return JSON.stringify({ symbol, ...fused, recommendation: recommend(fused, allocation ?? 0) });
        },
    });

    const key = generateKeyPairSync('ed25519');
    return startToolServerHttp(
        {
            name: SIGNALS_SERVER, tools: [getSignal],
            identity: { userId: options.actsFor ?? 'market-data' },
            agentIdentity: options.agentIdentity ?? ed25519AgentIdentities({ [SIGNALS_SERVER]: { id: 'did:example:agent:signals', privateKey: key.privateKey } }),
            ...(options.auditSink ? { auditSink: options.auditSink } : {}),
        },
        { port: 0, ...(options.authToken ? { authToken: options.authToken } : {}), log: () => undefined },
    );
}
