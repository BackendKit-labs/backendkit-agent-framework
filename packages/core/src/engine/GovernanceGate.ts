/**
 * The governance gate of the engine (SPEC-0014, SPEC-0041, SPEC-0042): what happens between "the model asked for a tool" and
 * "the tool runs". It decides with the policies, asks the approver (live) or the durable store, checks who may approve, expires
 * stored requests and leases the credentials a tool declared.
 *
 * It is the engine's own part, moved out of `AgentEngine` so the rules can be read and tested apart from the loop: it depends
 * on the small `GovernanceGateDeps` below, never on the engine, so it cannot reach back into it (and the circular-dependency
 * check of the CI stays green). The ORDER of the checks inside `decide` and `resolveAsk` is part of the contract: do not reorder.
 */
import { randomUUID } from 'node:crypto';
import { agentCouldPerform, combineDecisions, evaluatePolicies } from '../governance/policy';
import { checkApproval, previewArgs } from '../governance/approval';
import type {
    ApprovalRequest,
    ApprovalStore,
    Approver,
    ApproverAuthority,
    ApproverDirectory,
    ApproverRef,
    AuditCredential,
    AuditMandate,
    AuditSandboxDecision,
    CredentialBroker,
    CredentialLease,
    PolicyDecision,
    Principal,
    ToolCall,
    ToolPolicy,
} from '../governance/types';
import { hashArgs } from '../shared/utils/canonical-json';
import type { AgentProfile, ToolDefinition } from '../types';
import type { Transport } from '../transport/Transport';

/** What the policy path decided about one call, before it runs (SPEC-0014 F2). */
export type GovernedVerdict =
    | {
        run: true; mode?: 'run' | 'sandboxed' | 'dry_run'; approval?: { id: string; by: ApproverRef; authority?: ApproverAuthority; reason?: string }; mandate?: AuditMandate;
        /** Why a person was asked, and the mandate the call went beyond, when that was the reason: they go to the audit event of the approved call. */
        asked?: { reason: string; exceeds?: AuditMandate };
    }
    | { run: false; decision: 'deny' | 'ask' | 'sandbox_denied'; reason: string; message: string };

/** The only things the gate takes from the engine. */
export interface GovernanceGateDeps {
    policies: ToolPolicy[];
    approver?: Approver;
    approvals?: ApprovalStore;
    approverDirectory?: ApproverDirectory;
    credentialBroker?: CredentialBroker;
    forbidSelfApproval?: boolean;
    approvalTtlSeconds?: number;
    approverTimeoutMs?: number;
    /** Whether the engine has a sandbox at all (a policy that requires one is denied without it). */
    hasSandbox: boolean;
    /** What the sandbox policy says about a tool: 'ask' makes the call ask. */
    sandboxApprovalFor?: (who: { agentId: string; sessionId: string }, tool: ToolDefinition) => 'none' | 'ask' | undefined;
    agents: { get(id: string): AgentProfile | undefined };
    transport: Pick<Transport, 'emit'>;
    principalFor(agentId: string, chain?: string[]): Principal;
    /** The verdict (and the sandbox audit note) for a sandbox that wants approval when nobody can be asked. */
    noApproverForSandbox(tool: string, agentId: string, decisions: AuditSandboxDecision[]): GovernedVerdict;
}

export class GovernanceGate {
    constructor(private readonly deps: GovernanceGateDeps) {}

    /** Approval checks never overlap and run in call order, even inside a parallel wave. */
    private gateQueue: Promise<unknown> = Promise.resolve();
    serialize<T>(work: () => Promise<T>): Promise<T> {
        const next = this.gateQueue.then(work);
        this.gateQueue = next.catch(() => undefined);
        return next;
    }

    /** Arguments the model produced, as an object (anything else becomes `{}`). */
    private parseArgs(raw: string): Record<string, unknown> {
        try {
            const parsed = JSON.parse(raw) as unknown;
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
        } catch {
            return {};
        }
    }

    /**
     * The policy path (SPEC-0014 §2, F2): the policies decide on the arguments that would really run (after the
     * guardrails), a sandbox that wants approval adds an `ask`, and an `ask` goes to the approver in call order or,
     * when nobody answers now, to the durable store.
     */
    async decide(
        tool: ToolDefinition, rawArgs: string, principal: Principal, sandboxDecisions: AuditSandboxDecision[],
        approved?: ToolCall['approved'],
    ): Promise<GovernedVerdict> {
        // Arguments that are valid JSON but not an object would reach the policies as `{}`: refuse them instead.
        try {
            const parsed = JSON.parse(rawArgs) as unknown;
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                const reason = 'the arguments are not a JSON object';
                return { run: false, decision: 'deny', reason, message: `Tool call "${tool.name}" denied: ${reason}` };
            }
        } catch { /* not JSON at all: the tool reports it when it runs */ }
        // `approved` is never taken from what the model sent: only `runApproved`, which holds a stored approval, sets it.
        const call: ToolCall = { tool, args: this.parseArgs(rawArgs), ...(approved ? { approved } : {}) };
        const sandboxAsk = this.deps.sandboxApprovalFor?.({ agentId: principal.agentId, sessionId: principal.sessionId }, tool) === 'ask';

        let d = await evaluatePolicies(this.deps.policies, principal, call);
        if (sandboxAsk) d = combineDecisions([d, { effect: 'ask', reason: 'the sandbox policy requires approval' }]);

        if (d.effect === 'deny') {
            return { run: false, decision: 'deny', reason: d.reason, message: `Tool call "${tool.name}" denied by policy: ${d.reason}` };
        }
        if (d.effect === 'allow') {
            if (d.mode === 'sandboxed' && !this.deps.hasSandbox) {
                const reason = 'the policy requires a sandbox and none is configured';
                return { run: false, decision: 'deny', reason, message: `Tool call "${tool.name}" denied by policy: ${reason}` };
            }
            return { run: true, ...(d.mode ? { mode: d.mode } : {}), ...(approved ? { approval: { id: approved.approvalId, by: approved.by, ...(approved.reason ? { reason: approved.reason } : {}) } } : {}), ...(d.mandate ? { mandate: d.mandate } : {}) };
        }
        const ask = d as Extract<PolicyDecision, { effect: 'ask' }>;
        if (approved) {
            // A stored approval is run only while its request is alive (SPEC-0042 F3). An expiry that cannot be read is an expired one.
            if (approved.expiresAt !== undefined && !(Date.now() <= Date.parse(approved.expiresAt))) {
                const reason = `invalid approval: the request expired at ${approved.expiresAt}; ask again`;
                return { run: false, decision: 'deny', reason, message: `Tool call "${tool.name}" not run: ${reason}` };
            }
            // A stored approval satisfies the ask, but only if its approver is one this ask accepts (§6.2).
            // Who asked is what the stored request recorded, not the identity of whoever runs it now (SPEC-0041 F2). Who may approve is checked now,
            // against the policy of now (its roles) and the directory of now (SPEC-0041), not against what was stored.
            const authority = await checkApproval(
                { decision: 'approve', by: approved.by, at: new Date().toISOString() },
                {
                    principal: approved.requestedBy !== undefined ? { ...principal, userId: approved.requestedBy } : principal,
                    ...(ask.accepts ? { accepts: ask.accepts } : {}),
                    ...(ask.approverRoles ? { approverRoles: ask.approverRoles } : {}),
                },
                this.checkDeps(call),
            );
            if ('problem' in authority) {
                const reason = `invalid approval: ${authority.problem}`;
                return { run: false, decision: 'deny', reason, message: `Tool call "${tool.name}" not run: ${reason}` };
            }
            return {
                run: true, approval: { id: approved.approvalId, by: approved.by, ...(authority.authority ? { authority: authority.authority } : {}), ...(approved.reason ? { reason: approved.reason } : {}) },
                asked: { reason: ask.reason, ...(ask.exceeds ? { exceeds: ask.exceeds } : {}) },
            };
        }
        return this.serialize(() => this.resolveAsk(principal, call, ask, sandboxAsk, sandboxDecisions));
    }

    /**
     * Leases, one by one, the credentials a tool declared (SPEC-0042 F4). All or nothing: if any fails, those already leased are
     * released and the call is refused. Fails closed on everything it cannot trust: no broker, a refusal, a lease with no value or no
     * id, a lease that is already expired or whose expiry cannot be read.
     */
    async leaseCredentials(tool: import('../types').ToolDefinition, rawArgs: string, principal: Principal, approval?: { id: string; by: ApproverRef }): Promise<
        { problem: string } | { leases: Array<{ name: string; lease: CredentialLease }>; values: Record<string, string>; audit: AuditCredential[] }
    > {
        const names = tool.credentials ?? [];
        const broker = this.deps.credentialBroker;
        if (!broker) return { problem: `tool "${tool.name}" needs credentials (${names.join(', ')}) and no credential broker is configured` };
        const argsHash = hashArgs(this.parseArgs(rawArgs));
        const held = { leases: [] as Array<{ name: string; lease: CredentialLease }>, values: {} as Record<string, string>, audit: [] as AuditCredential[] };
        for (const name of names) {
            let lease: CredentialLease | undefined;
            try {
                lease = await broker.lease({ name, tool: tool.name, argsHash, principal, ...(approval ? { approval: { id: approval.id, by: approval.by } } : {}) });
            } catch (err) {
                await this.releaseCredentials(held);
                return { problem: `the credential broker refused "${name}": ${err instanceof Error ? err.message : String(err)}` };
            }
            const unusable =
                !lease || typeof lease.value !== 'string' || lease.value.length === 0 ? 'it has no value'
                : typeof lease.id !== 'string' || lease.id.length === 0 ? 'it has no id'
                : lease.expiresAt !== undefined && !(Date.parse(lease.expiresAt) > Date.now()) ? 'it is expired or its expiry cannot be read'
                : undefined;
            if (unusable) {
                try { await lease?.release?.(); } catch { /* nothing more can be done with a lease that is not usable */ }
                await this.releaseCredentials(held);
                return { problem: `the credential broker returned an unusable lease for "${name}": ${unusable}` };
            }
            held.leases.push({ name, lease: lease! });
            held.values[name] = lease!.value;
            held.audit.push({ name, id: lease!.id, ...(lease!.expiresAt !== undefined ? { expiresAt: lease!.expiresAt } : {}), released: false });
        }
        return held;
    }

    /** Releases the leases of a call, whatever the outcome. A release that fails is recorded (`released: false`), not hidden and not fatal to the result. */
    async releaseCredentials(held: { leases: Array<{ name: string; lease: CredentialLease }>; audit: AuditCredential[] }): Promise<AuditCredential[]> {
        for (let i = 0; i < held.leases.length; i++) {
            let released = true;
            try { await held.leases[i]!.lease.release?.(); } catch { released = false; }
            held.audit[i] = { ...held.audit[i]!, released };
        }
        return held.audit;
    }

    /** `expiresAt` of a new request: the shorter of what the `ask` says and the engine's `approvalTtlSeconds`; none when neither is set. */
    private expiryOf(d: Extract<PolicyDecision, { effect: 'ask' }>): { expiresAt?: string } {
        const set = [d.ttlSeconds, this.deps.approvalTtlSeconds].filter(v => v !== undefined);
        if (set.length === 0) return {};
        // A ttl that is not a positive number (0, negative, NaN) expires at once: a mistake must not turn into "never expires".
        const seconds = set.map(v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0));
        return { expiresAt: new Date(Date.now() + Math.min(...seconds) * 1000).toISOString() };
    }

    private async resolveAsk(
        principal: Principal, call: ToolCall, d: Extract<PolicyDecision, { effect: 'ask' }>,
        sandboxAsk: boolean, sandboxDecisions: AuditSandboxDecision[],
    ): Promise<GovernedVerdict> {
        const name = call.tool.name;
        const request: ApprovalRequest = {
            id: randomUUID(), principal, subject: { kind: 'tool_call', call }, reason: d.reason,
            ...(d.approver ? { approver: d.approver } : {}),
            ...(d.accepts ? { accepts: d.accepts } : {}),
            ...(d.approverRoles ? { approverRoles: d.approverRoles } : {}),
            createdAt: new Date().toISOString(),
            ...this.expiryOf(d),
        };

        if (this.deps.approver) {
            this.deps.transport.emit({
                type: 'tool_approval_request', tool_name: name, agent_id: principal.agentId,
                args_preview: previewArgs(JSON.stringify(call.args)).text,
            });
            let answer;
            let waitTimer: ReturnType<typeof setTimeout> | undefined;
            try {
                const waitMs = this.deps.approverTimeoutMs;
                answer = waitMs === undefined
                    ? await this.deps.approver.request(request)
                    : await Promise.race([
                        this.deps.approver.request(request),
                        new Promise<never>((_, reject) => { waitTimer = setTimeout(() => reject(new Error(`it did not answer in ${waitMs}ms`)), waitMs); }),
                    ]);
            } catch (err) {
                const reason = `the approver failed: ${err instanceof Error ? err.message : String(err)}`;
                return { run: false, decision: 'deny', reason, message: `Tool call "${name}" not run: ${reason}` };
            } finally {
                clearTimeout(waitTimer);
            }
            if (answer.decision !== 'approve') {
                return {
                    run: false, decision: 'deny', reason: answer.reason ?? 'rejected by the approver',
                    message: `Tool call "${name}" was rejected by the approver.`,
                };
            }
            const authority = await checkApproval(answer, request, this.checkDeps(call));
            if ('problem' in authority) {
                const reason = `invalid approval: ${authority.problem}`;
                return { run: false, decision: 'deny', reason, message: `Tool call "${name}" not run: ${reason}` };
            }
            return {
                run: true, approval: { id: request.id, by: answer.by, ...(authority.authority ? { authority: authority.authority } : {}), ...(answer.reason ? { reason: answer.reason } : {}) },
                asked: { reason: d.reason, ...(d.exceeds ? { exceeds: d.exceeds } : {}) },
            };
        }

        if (this.deps.approvals) {
            await this.deps.approvals.put(request);
            return {
                run: false, decision: 'ask', reason: d.reason,
                message: `Tool call "${name}" needs approval (${d.reason}) and is pending as request ${request.id}. ` +
                    'It has NOT run; it will run once someone approves it.',
            };
        }

        if (sandboxAsk) return this.deps.noApproverForSandbox(name, principal.agentId, sandboxDecisions);
        const reason = `needs approval (${d.reason}) and no approver is configured`;
        return { run: false, decision: 'deny', reason, message: `Tool call "${name}" refused: ${reason}.` };
    }

    /** What the shared check of an approval needs from this engine. */
    private checkDeps(call: ToolCall) {
        return {
            canAgentAct: (by: ApproverRef) => this.agentCanPerform(by, call),
            ...(this.deps.approverDirectory ? { approverDirectory: this.deps.approverDirectory } : {}),
            ...(this.deps.forbidSelfApproval ? { forbidSelfApproval: true } : {}),
        };
    }

    /**
     * Rule 3 of SPEC-0014 §6.2: an agent approves only what it could do itself. It must be registered, have the
     * tool in its allowedTools, and the policies must allow the same call with that agent as principal.
     */
    private async agentCanPerform(by: ApproverRef, call: ToolCall): Promise<boolean> {
        const approverProfile = this.deps.agents.get(by.id);
        if (!approverProfile) return false;
        if (!approverProfile.allowedTools.includes(call.tool.name)) return false;
        const d = await evaluatePolicies(this.deps.policies, this.deps.principalFor(by.id, by.chain ?? [by.id]), { tool: call.tool, args: call.args });
        return agentCouldPerform(d);
    }
}
