import { randomUUID } from 'node:crypto';
import { promptInjectionGuardrail, secretLeakGuardrail } from '@backendkit-labs/agent-core';
import type { Guardrail, GuardrailContext } from '@backendkit-labs/agent-core';
import { AuditLog, type AuditEvent, type AuditListener } from './audit';
import type { AgentConnector, RunHandle, RunOutcome } from './connectors/types';
import { FleetRegistry, type FleetAgent, type RegistryOptions } from './fleet/FleetRegistry';
import type { ApprovalMode, FleetConfig } from './fleet/schema';
import { ACTIVE, JsonRunStore, type RunRecord, type RunStore, type StoredStatus } from './store/RunStore';

/** Who is asking. It comes from the transport (a JWT, an MCP token, the host's login); Hermes only reads it. */
export interface Principal {
    id: string;
    roles: string[];
}

export type HermesErrorCode =
    | 'FORBIDDEN' | 'APPROVAL_REQUIRED' | 'AGENT_NOT_FOUND' | 'AGENT_UNAVAILABLE' | 'CAPABILITY_NOT_FOUND' | 'RUN_NOT_FOUND' | 'RUN_FAILED';

export class HermesError extends Error {
    constructor(readonly code: HermesErrorCode, message: string) {
        super(message);
        this.name = 'HermesError';
    }
}

export interface ApprovalRequest {
    action: 'run' | 'cancel';
    principal: Principal;
    agentId: string;
    capability: string;
    /** The input, masked and cut: what a human needs to decide. */
    inputPreview?: string;
    runId?: string;
}

/** Decides whether an action that asks for approval may go on. Without one, those actions are refused. */
export type Approver = (request: ApprovalRequest) => boolean | Promise<boolean>;

export interface HermesOptions extends RegistryOptions {
    fleet: FleetConfig;
    store?: RunStore;
    /** Where the run store is kept when `store` is not given. Without either, runs live only in memory. */
    storeFile?: string;
    auditLog?: string;
    onAudit?: AuditListener;
    approver?: Approver;
    /** Longest an `agent_run` waits for the answer before returning the run id. Default 30 s. */
    defaultWaitMs?: number;
    /** Results longer than this are cut (the run store and the model never get more). Default 64000 characters. */
    maxOutputChars?: number;
    guardrails?: Guardrail[];
}

export interface RunView {
    runId: string;
    agentId: string;
    capability: string;
    status: StoredStatus;
    startedAt: string;
    finishedAt?: string;
    output?: string;
    error?: string;
}

/** The guardrails Hermes applies to what agents answer: a result is data from outside, not an instruction. */
export const defaultResultGuardrails = (): Guardrail[] => [secretLeakGuardrail(), promptInjectionGuardrail()];

const view = (r: RunRecord): RunView => ({
    runId: r.runId, agentId: r.agentId, capability: r.capability, status: r.status, startedAt: r.startedAt,
    ...(r.finishedAt ? { finishedAt: r.finishedAt } : {}),
    ...(r.output !== undefined ? { output: r.output } : {}),
    ...(r.error ? { error: r.error } : {}),
});

interface Tracked { handle: RunHandle; settled: Promise<void> }

export class Hermes {
    readonly registry: FleetRegistry;
    readonly store: RunStore;
    private readonly audit: AuditLog;
    private readonly tracked = new Map<string, Tracked>();
    private readonly guardrails: Guardrail[];
    private started = false;
    /** Aborted on `stop()`: runs stop being followed, but they do not end because of it, so the store keeps them as they were. */
    private readonly shutdown = new AbortController();

    constructor(private readonly options: HermesOptions) {
        this.store = options.store ?? new JsonRunStore(options.storeFile);
        this.audit = new AuditLog(options.auditLog, options.onAudit);
        this.guardrails = options.guardrails ?? defaultResultGuardrails();
        this.registry = new FleetRegistry(options.fleet, {
            ...(options.inProcess ? { inProcess: options.inProcess } : {}),
            ...(options.env ? { env: options.env } : {}),
            onHealthChange: (agent, previous) => {
                options.onHealthChange?.(agent, previous);
                // An agent that answers again may know the runs we could not ask about while it was away.
                if (this.started && agent.health.state !== 'down' && previous === 'down') void this.reconcile(agent.id);
            },
        });
    }

    /** Checks the fleet, then settles the runs a previous process left open. */
    async start(): Promise<void> {
        await this.registry.start();
        this.started = true;
        await this.reconcile();
    }

    async stop(): Promise<void> {
        this.started = false;
        this.shutdown.abort();
        this.registry.stop();
        await this.audit.flush();
        await this.store.flush?.();
    }

    // ── Reading the fleet ───────────────────────────────────────────────────

    /** The agents this principal may use, with their state. */
    list(principal: Principal): Array<{ id: string; description?: string; tags: string[]; state: string; latencyMs?: number; capabilities: string[] }> {
        this.audit.record({ action: 'list', outcome: 'allowed', principalId: principal.id });
        return this.registry.list().filter(a => this.mayUse(principal, a)).map(a => ({
            id: a.id,
            ...((a.config.description ?? a.descriptor?.description) ? { description: a.config.description ?? a.descriptor?.description } : {}),
            tags: a.config.tags ?? [],
            state: a.health.state,
            ...(a.health.latencyMs !== undefined ? { latencyMs: a.health.latencyMs } : {}),
            capabilities: (a.descriptor?.capabilities ?? []).map(c => c.name),
        }));
    }

    async info(principal: Principal, agentId: string) {
        const agent = this.agentFor(principal, agentId, 'info');
        const descriptor = await agent.connector.describe().catch(err => { throw new HermesError('AGENT_UNAVAILABLE', `${agentId}: ${(err as Error).message}`); });
        agent.descriptor = descriptor;
        return { id: agentId, state: agent.health.state, ...descriptor };
    }

    health(principal: Principal) {
        const agents = this.registry.list().filter(a => this.mayUse(principal, a)).map(a => ({
            id: a.id, ...a.health,
        }));
        this.audit.record({ action: 'health', outcome: 'allowed', principalId: principal.id });
        const count = (s: string) => agents.filter(a => a.state === s).length;
        return { total: agents.length, ok: count('ok'), degraded: count('degraded'), down: count('down'), unknown: count('unknown'), agents };
    }

    // ── Running ─────────────────────────────────────────────────────────────

    /**
     * Starts a capability of an agent. With `wait` it answers when the run ends (or after `waitMs`, with the run
     * still going); without it, at once with the run id. The default is to wait for quick capabilities only.
     */
    async run(principal: Principal, request: { agentId: string; capability: string; input?: Record<string, unknown>; wait?: boolean; waitMs?: number; traceId?: string }): Promise<RunView> {
        const agent = this.agentFor(principal, request.agentId, 'run', request.capability);
        const { capability } = request;
        const input = request.input ?? {};
        const known = agent.descriptor?.capabilities.find(c => c.name === capability);
        if (agent.descriptor && !known) throw new HermesError('CAPABILITY_NOT_FOUND', `${agent.id} has no capability "${capability}"`);
        this.requireRoles(principal, agent, 'run', capability);
        if (agent.health.state === 'down') {
            this.audit.record({ action: 'run', outcome: 'denied', principalId: principal.id, agentId: agent.id, capability, reason: 'agent is down' });
            throw new HermesError('AGENT_UNAVAILABLE', `${agent.id} is down: ${agent.health.detail ?? 'no answer'}`);
        }
        const inputPreview = this.mask(JSON.stringify(input), 500);
        await this.requireApproval({ action: 'run', principal, agentId: agent.id, capability, inputPreview }, this.approvalMode(agent, capability));

        const runId = randomUUID();
        const wait = request.wait ?? !(known?.async ?? false);
        const record: RunRecord = {
            runId, agentId: agent.id, capability, inputPreview, status: 'pending', principalId: principal.id,
            ...(request.traceId ? { traceId: request.traceId } : {}), startedAt: new Date().toISOString(),
        };
        await this.store.put(record);

        let handle: RunHandle;
        try {
            handle = await agent.connector.run(
                { capability, input, async: !wait },
                { signal: this.shutdown.signal, ...(request.traceId ? { traceId: request.traceId } : {}) },
            );
        } catch (err) {
            const message = (err as Error).message;
            await this.store.update(runId, { status: 'failed', error: message, finishedAt: new Date().toISOString() });
            this.audit.record({ action: 'run', outcome: 'failed', principalId: principal.id, agentId: agent.id, capability, runId, reason: message });
            throw new HermesError('RUN_FAILED', `${agent.id}.${capability}: ${message}`);
        }
        await this.store.update(runId, { status: 'running', connectorRunId: handle.connectorRunId });
        this.audit.record({ action: 'run', outcome: 'allowed', principalId: principal.id, agentId: agent.id, capability, runId });
        const settled = this.track(runId, handle);

        if (wait) {
            const limit = request.waitMs ?? agent.config.limits?.deadlineMs ?? this.options.defaultWaitMs ?? 30_000;
            await Promise.race([settled, new Promise<void>(r => { const t = setTimeout(r, limit); t.unref?.(); })]);
        }
        return view(this.store.get(runId)!);
    }

    status(principal: Principal, runId: string): RunView {
        const record = this.recordFor(principal, runId);
        const { output: _output, ...rest } = view(record);
        return rest;
    }

    result(principal: Principal, runId: string): RunView {
        return view(this.recordFor(principal, runId));
    }

    async cancel(principal: Principal, runId: string): Promise<RunView> {
        const record = this.recordFor(principal, runId);
        const agent = this.registry.get(record.agentId);
        if (!ACTIVE.includes(record.status)) return view(record);
        if (agent) {
            this.requireRoles(principal, agent, 'cancel', record.capability);
            await this.requireApproval({ action: 'cancel', principal, agentId: agent.id, capability: record.capability, runId }, this.approvalMode(agent, record.capability));
        }
        const tracked = this.tracked.get(runId);
        try {
            if (tracked) await tracked.handle.cancel('cancelled by ' + principal.id);
            else if (agent?.connector.cancel && record.connectorRunId) await agent.connector.cancel(record.connectorRunId);
        } catch (err) {
            this.audit.record({ action: 'cancel', outcome: 'failed', principalId: principal.id, agentId: record.agentId, runId, reason: (err as Error).message });
            throw new HermesError('AGENT_UNAVAILABLE', `could not cancel ${runId}: ${(err as Error).message}`);
        }
        const updated = await this.settle(runId, { status: 'cancelled' });
        this.audit.record({ action: 'cancel', outcome: 'allowed', principalId: principal.id, agentId: record.agentId, capability: record.capability, runId });
        return view(updated ?? this.store.get(runId)!);
    }

    // ── After a restart ─────────────────────────────────────────────────────

    /**
     * Settles the runs the store still shows as going but this process is not following. The agent decides: a run it
     * knows is picked up again, one it does not is `lost`. An in-process agent cannot outlive Hermes, so its runs are
     * `lost`. An agent that cannot be reached right now leaves its runs as they are, to be tried again when it is back.
     */
    async reconcile(agentId?: string): Promise<void> {
        const open = this.store.list({ ...(agentId ? { agentId } : {}), status: [...ACTIVE] }).filter(r => !this.tracked.has(r.runId));
        for (const record of open) {
            const agent = this.registry.get(record.agentId);
            const lost = async (reason: string) => {
                await this.settle(record.runId, { status: 'lost', error: reason });
                this.audit.record({ action: 'reconcile', outcome: 'lost', agentId: record.agentId, runId: record.runId, reason });
            };
            if (!agent) { await lost('the agent is no longer in the fleet'); continue; }
            if (!agent.connector.lookup || !record.connectorRunId) { await lost('the run did not outlive the Hermes process'); continue; }
            try {
                const found = await agent.connector.lookup(record.connectorRunId);
                if (!found.found) { await lost('the agent does not know this run'); continue; }
                if (found.status === 'pending' || found.status === 'running') {
                    if (agent.connector.follow) this.track(record.runId, agent.connector.follow(record.connectorRunId, this.shutdown.signal));
                } else {
                    await this.settle(record.runId, { status: found.status, ...(found.output !== undefined ? { output: found.output } : {}), ...(found.error ? { error: found.error } : {}) });
                }
                this.audit.record({ action: 'reconcile', outcome: 'recovered', agentId: record.agentId, runId: record.runId });
            } catch (err) {
                this.audit.record({ action: 'reconcile', outcome: 'failed', agentId: record.agentId, runId: record.runId, reason: `could not ask the agent: ${(err as Error).message}` });
            }
        }
    }

    // ── Internals ───────────────────────────────────────────────────────────

    /** Follows a run until it ends and writes the outcome to the store as soon as it is known. */
    private track(runId: string, handle: RunHandle): Promise<void> {
        const settled = handle.result()
            .catch((err): RunOutcome => ({ status: 'failed', error: (err as Error).message }))
            .then(async outcome => { if (!this.shutdown.signal.aborted) await this.settle(runId, outcome); })
            .finally(() => { this.tracked.delete(runId); });
        this.tracked.set(runId, { handle, settled });
        return settled;
    }

    /** Records how a run ended, once: a run that already ended keeps the first answer. */
    private async settle(runId: string, outcome: { status: StoredStatus; output?: unknown; error?: string }): Promise<RunRecord | undefined> {
        const current = this.store.get(runId);
        if (!current || !ACTIVE.includes(current.status)) return current;
        return this.store.update(runId, {
            status: outcome.status,
            finishedAt: new Date().toISOString(),
            ...(outcome.output !== undefined ? { output: this.sanitize(outcome.output) } : {}),
            ...(outcome.error ? { error: this.mask(outcome.error, 2000) } : {}),
        });
    }

    private agentFor(principal: Principal, agentId: string, action: 'run' | 'info', capability?: string): FleetAgent {
        const agent = this.registry.get(agentId);
        // An agent the principal may not use is reported as missing: the fleet is not enumerable through error messages.
        if (!agent || !this.mayUse(principal, agent)) {
            if (agent) this.audit.record({ action, outcome: 'denied', principalId: principal.id, agentId, ...(capability ? { capability } : {}), reason: 'role' });
            throw new HermesError(agent ? 'FORBIDDEN' : 'AGENT_NOT_FOUND', agent ? `${principal.id} may not use ${agentId}` : `no agent "${agentId}" in the fleet`);
        }
        return agent;
    }

    private recordFor(principal: Principal, runId: string): RunRecord {
        const record = this.store.get(runId);
        const agent = record && this.registry.get(record.agentId);
        if (!record || (agent && !this.mayUse(principal, agent))) throw new HermesError('RUN_NOT_FOUND', `no run "${runId}"`);
        return record;
    }

    private mayUse(principal: Principal, agent: FleetAgent): boolean {
        const roles = agent.config.access?.roles;
        return !roles || roles.some(r => principal.roles.includes(r));
    }

    private requireRoles(principal: Principal, agent: FleetAgent, action: 'run' | 'cancel', capability: string): void {
        const roles = agent.config.access?.capabilities?.[capability]?.roles;
        if (roles && !roles.some(r => principal.roles.includes(r))) {
            this.audit.record({ action, outcome: 'denied', principalId: principal.id, agentId: agent.id, capability, reason: 'role for capability' });
            throw new HermesError('FORBIDDEN', `${principal.id} may not use ${agent.id}.${capability}`);
        }
    }

    private approvalMode(agent: FleetAgent, capability: string): ApprovalMode {
        return agent.config.access?.capabilities?.[capability]?.approval
            ?? agent.config.access?.approval
            ?? this.options.fleet.policies?.approval?.default
            ?? 'ask';
    }

    /** `ask` and `always` both need the approver (they differ only in what a future policy may remember); with none, the action is refused. */
    private async requireApproval(request: ApprovalRequest, mode: ApprovalMode): Promise<void> {
        if (mode === 'never') return;
        const base = { action: request.action, principalId: request.principal.id, agentId: request.agentId, capability: request.capability } as const;
        if (!this.options.approver) {
            this.audit.record({ ...base, outcome: 'denied', reason: 'needs approval and no approver is configured' });
            throw new HermesError('APPROVAL_REQUIRED', `${request.action} on ${request.agentId}.${request.capability} needs approval and no approver is configured`);
        }
        if (!(await this.options.approver(request))) {
            this.audit.record({ ...base, outcome: 'not-approved' });
            throw new HermesError('APPROVAL_REQUIRED', `${request.action} on ${request.agentId}.${request.capability} was not approved`);
        }
        this.audit.record({ ...base, outcome: 'approved' });
    }

    // ── What comes back from an agent is data ───────────────────────────────

    private secretValues(): string[] {
        const env = this.options.env ?? process.env;
        return this.options.fleet.agents.flatMap(a => {
            const ref = a.connector.kind === 'protocol' ? a.connector.apiKey?.env : undefined;
            const v = ref ? env[ref] : undefined;
            return v ? [v] : [];
        });
    }

    private applyGuardrails(content: string, toolName: string): string {
        let text = content;
        for (const g of this.guardrails) {
            const ctx: GuardrailContext = { phase: 'tool_result', agentId: 'hermes', sessionId: 'hermes', content: text, toolName, secretValues: this.secretValues() };
            const decision = g.check(ctx);
            if (decision instanceof Promise) continue; // the built-in checks are synchronous; an async one belongs on the engine
            if (decision.action === 'block') return `[withheld by guardrail ${g.name}: ${decision.reason}]`;
            if (decision.action === 'redact') text = decision.content;
        }
        return text;
    }

    private sanitize(output: unknown): string {
        const max = this.options.maxOutputChars ?? 64_000;
        const raw = typeof output === 'string' ? output : (JSON.stringify(output) ?? '');
        const cut = raw.length > max ? `${raw.slice(0, max)}… [cut at ${max} characters]` : raw;
        return this.applyGuardrails(cut, 'agent_result');
    }

    /** Masks anything that looks like a credential, then cuts: what is stored about an input. */
    private mask(text: string, max: number): string {
        const redacted = secretLeakGuardrail().check({ phase: 'tool_result', agentId: 'hermes', sessionId: 'hermes', content: text, secretValues: this.secretValues() });
        const masked = !(redacted instanceof Promise) && redacted.action === 'redact' ? redacted.content : text;
        return masked.length > max ? `${masked.slice(0, max)}…` : masked;
    }
}

export type { AgentConnector, AuditEvent };
