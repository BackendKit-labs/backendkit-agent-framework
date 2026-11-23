/**
 * The identity gate of a capability server (SPEC-0044). `AgentServer` of `@backendkit-labs/agent-protocol` runs capabilities and flows for remote
 * callers; that is another way to act, so it runs nothing without a gate. This builds one with the same rule and the same default as the engine:
 * the agent has a digital identity and says for whom it acts, or the run is refused; every run leaves an audit event attributed to that identity and
 * signed by it when the provider can sign.
 *
 * The protocol authenticates a caller with one shared key and nothing more, so who a run is FOR is not in the request: the operator says it, with a
 * fixed `identity` or a function of the call (from headers the operator authenticated, such as a verified token).
 */
import type { CapabilityCall, CapabilityGate } from '@backendkit-labs/agent-protocol';
import { hashArgs } from '../shared/utils/canonical-json';
import { AuditDispatcher } from './audit';
import { IdentityResolver, type AgentIdentity, type AgentIdentityContext, type AgentIdentityProvider } from './agent-identity';
import { eventSigningMessage } from './agent-signature';
import type { AuditEvent, AuditSink, Identity } from './types';

export interface CapabilityIdentityGateOptions {
    /** The agent that serves the capabilities: its name is the `agentId` the identity provider resolves and the audit records. */
    name: string;
    /** Gives the agent its digital identity. Required by default. See `selfAssertedIdentities`, `ed25519AgentIdentities`. */
    agentIdentity?: AgentIdentityProvider;
    /**
     * For whom the runs are: a fixed identity, or a function of the call. `userId` is required by default. Do NOT read it from `x-tenant-id` or any
     * header the caller can set on its own; derive it from something you verified (a validated token).
     */
    identity?: Identity | ((call: CapabilityCall) => Identity | undefined | Promise<Identity | undefined>);
    /** Default `true`. `false` lets runs through with no identity, for tests only. */
    requireAgentIdentity?: boolean;
    agentIdentityTimeoutMs?: number;
    agentIdentityCacheMs?: number;
    /** Default `true`: audit events are signed by the identity when its provider can sign. */
    signAuditEvents?: boolean;
    /** One `AuditEvent` per run, in the engine's format. A failing sink goes to stderr and changes nothing. */
    auditSink?: AuditSink | AuditSink[];
}

export function capabilityIdentityGate(opts: CapabilityIdentityGateOptions): CapabilityGate {
    const identities = new IdentityResolver({
        ...(opts.agentIdentity ? { provider: opts.agentIdentity } : {}),
        ...(opts.requireAgentIdentity !== undefined ? { require: opts.requireAgentIdentity } : {}),
        ...(opts.agentIdentityTimeoutMs !== undefined ? { timeoutMs: opts.agentIdentityTimeoutMs } : {}),
        ...(opts.agentIdentityCacheMs !== undefined ? { cacheMs: opts.agentIdentityCacheMs } : {}),
        warn: (text) => process.stderr.write(`[${opts.name}] ${text}\n`),
    });
    const sinks = new AuditDispatcher(opts.auditSink, (err) =>
        process.stderr.write(`[${opts.name}] audit sink failed: ${err instanceof Error ? err.message : String(err)}\n`));

    async function record(
        call: CapabilityCall, started: number, context: AgentIdentityContext, who: AgentIdentity | undefined,
        decision: 'allow' | 'deny', outcome?: 'ok' | 'error', reason?: string,
    ): Promise<void> {
        if (!sinks.enabled) return;
        let event: AuditEvent = {
            at: new Date(started).toISOString(),
            principal: {
                agentId: opts.name, sessionId: context.sessionId, chain: [opts.name],
                ...(context.tenantId !== undefined ? { tenantId: context.tenantId } : {}),
                ...(context.userId !== undefined ? { userId: context.userId } : {}),
            },
            ...(who ? { agentIdentity: who } : { agentIdentityMissing: true as const }),
            tool: call.capability,
            argsHash: hashArgs(call.input),
            decision,
            ...(reason !== undefined ? { reason } : {}),
            ...(outcome !== undefined ? { outcome } : {}),
            durationMs: Date.now() - started,
        };
        if (opts.signAuditEvents !== false && who && identities.canSign) {
            try {
                event = { ...event, agentSignature: await identities.sign(opts.name, context, eventSigningMessage(event)) };
            } catch {
                event = { ...event, agentSignatureFailed: true };
            }
        }
        await sinks.write(event);
    }

    return async (call) => {
        const started = Date.now();
        let who: Identity | undefined;
        try {
            who = typeof opts.identity === 'function' ? await opts.identity(call) : opts.identity;
        } catch (err) {
            const reason = `the identity of the caller could not be established: ${err instanceof Error ? err.message : String(err)}`;
            await record(call, started, { sessionId: call.context.requestId ?? 'protocol' }, undefined, 'deny', undefined, reason);
            return { ok: false, code: 'FORBIDDEN', message: reason };
        }
        const context: AgentIdentityContext = {
            sessionId: call.context.requestId ?? 'protocol',
            ...(who?.tenantId !== undefined ? { tenantId: who.tenantId } : {}),
            ...(who?.userId !== undefined ? { userId: who.userId } : {}),
        };
        const checked = await identities.check(opts.name, context);
        const attributed = checked.ok ? checked.identity : identities.peek(opts.name);
        if (!checked.ok) {
            await record(call, started, context, attributed, 'deny', undefined, checked.reason);
            return { ok: false, code: 'FORBIDDEN', message: checked.reason };
        }
        return {
            ok: true,
            context: { ...(context.userId !== undefined ? { userId: context.userId } : {}), ...(checked.identity ? { agentIdentity: checked.identity } : {}) },
            finish: (outcome) => record(call, started, context, checked.identity, 'allow', outcome.ok ? 'ok' : 'error', outcome.error),
        };
    };
}
