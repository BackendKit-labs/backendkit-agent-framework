import { randomUUID } from 'node:crypto';
import { promptInjectionGuardrail, secretLeakGuardrail } from '@backendkit-labs/agent-core';
import type { Guardrail, GuardrailContext } from '@backendkit-labs/agent-core';
import { AuditLog, type AuditEvent, type AuditListener } from './audit';
import type { AgentAuditEntry, AgentConnector, AgentControlPort, FlowPort, FlowRunState, RunHandle, RunOutcome } from './connectors/types';
import { FleetRegistry, type FleetAgent, type RegistryOptions } from './fleet/FleetRegistry';
import type { ApprovalMode, FleetConfig } from './fleet/schema';
import { ACTIVE, JsonRunStore, type RunRecord, type RunStore, type StoredStatus } from './store/RunStore';
import { HermesError, type ApprovalRequest, type Approver, type HermesErrorCode, type HermesEvent, type Principal } from './errors';
import { matchScore, Provisioning, type Provision } from './provisioning/Provisioning';

export { HermesError } from './errors';
export type { Principal, HermesErrorCode, ApprovalRequest, Approver, HermesEvent } from './errors';

export interface HermesOptions extends RegistryOptions {
    fleet: FleetConfig;
    store?: RunStore;
    /** Where the run store is kept when `store` is not given. Without either, runs live only in memory. */
    storeFile?: string;
    auditLog?: string;
    onAudit?: AuditListener;
    approver?: Approver;
    /** Builds the agent a blueprint describes. Without it Hermes cannot create agents. */
    provision?: Provision;
    /** Where created agents, drafts and gaps are kept. Without it they live only in memory. */
    provisioningFile?: string;
    /** Events for the host: `fleet.gap`, `fleet.agent.created`, `fleet.agent.retired`, `fleet.blueprint.*`. */
    onEvent?: (event: HermesEvent) => void;
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

type AuditRow = { source: string; ts: string; [key: string]: unknown };

export class Hermes {
    readonly registry: FleetRegistry;
    readonly store: RunStore;
    private readonly audit: AuditLog;
    private readonly tracked = new Map<string, Tracked>();
    private readonly guardrails: Guardrail[];
    readonly provisioning: Provisioning;
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
        this.provisioning = new Provisioning({
            fleet: options.fleet,
            registry: this.registry,
            audit: this.audit,
            ...(options.provision ? { provision: options.provision } : {}),
            ...(options.provisioningFile ? { stateFile: options.provisioningFile } : {}),
            approve: (request, mode) => this.requireApproval(request, mode),
            cancelRunsOf: (agentId, reason) => this.cancelRunsOf(agentId, reason),
            emit: event => { try { options.onEvent?.(event); } catch { /* the host's handler must not affect Hermes */ } },
            find: (principal, need) => this.find(principal, need),
        });
    }

    /** Checks the fleet, then settles the runs a previous process left open. */
    async start(): Promise<void> {
        await this.registry.start();
        await this.provisioning.start();
        this.started = true;
        await this.reconcile();
    }

    async stop(): Promise<void> {
        this.started = false;
        this.shutdown.abort();
        this.registry.stop();
        await this.provisioning.stop();
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

    // ── Controlling an agent's execution ────────────────────────────────────

    /** The sandbox policy in force on an agent, with its version. Needs the right to use the agent. */
    async policyGet(principal: Principal, agentId: string): Promise<{ version: number; policy: unknown }> {
        const { port } = this.controlFor(principal, agentId, 'read');
        return await this.callControl(principal, agentId, port, 'get_sandbox_policy', {}, false) as { version: number; policy: unknown };
    }

    /**
     * Sets the sandbox policy of an agent. Needs one of the agent's `controlRoles` and, unless the agent is set to `never`,
     * an approval. The agent still decides for itself: a policy wider than the one in force is refused there unless its own
     * approver allows it, and nothing goes past the ceiling its operator set. `expectedVersion` makes the change fail if the
     * policy moved since it was read.
     */
    async policySet(principal: Principal, agentId: string, policy: unknown, expectedVersion?: number): Promise<{ version: number; policy: unknown }> {
        const { agent, port } = this.controlFor(principal, agentId, 'write');
        await this.requireApproval(
            { action: 'policy_set', principal, agentId, capability: 'set_sandbox_policy', inputPreview: this.mask(JSON.stringify(policy) ?? '', 500) },
            this.approvalMode(agent, 'set_sandbox_policy'),
        );
        return await this.callControl(principal, agentId, port, 'set_sandbox_policy', {
            policy, by: principal.id, ...(expectedVersion !== undefined ? { expectedVersion } : {}),
        }, true) as { version: number; policy: unknown };
    }

    /** Background jobs of an agent (all owners, or one). */
    async jobList(principal: Principal, agentId: string, owner?: string): Promise<unknown> {
        const { port } = this.controlFor(principal, agentId, 'read');
        return await this.callControl(principal, agentId, port, 'list_jobs', owner ? { owner } : {}, false);
    }

    async jobCancel(principal: Principal, agentId: string, jobId: string): Promise<unknown> {
        const { agent, port } = this.controlFor(principal, agentId, 'write');
        await this.requireApproval({ action: 'job_cancel', principal, agentId, capability: 'cancel_job', inputPreview: jobId }, this.approvalMode(agent, 'cancel_job'));
        return await this.callControl(principal, agentId, port, 'cancel_job', { id: jobId, by: principal.id }, true);
    }

    /**
     * One trail for the whole fleet: what Hermes decided and what each agent decided (its sandbox and control decisions),
     * in time order. Agents without a control channel, or that cannot be reached, are listed in `unavailable` instead.
     */
    async auditView(principal: Principal, query: { agentId?: string; since?: string; limit?: number } = {}) {
        const since = query.since ? Date.parse(query.since) : undefined;
        if (query.since && Number.isNaN(since)) throw new HermesError('INVALID_INPUT', "'since' must be an ISO timestamp");
        if (query.agentId) this.agentFor(principal, query.agentId, 'control');
        const visible = this.registry.list().filter(a => this.mayUse(principal, a) && (!query.agentId || a.id === query.agentId));
        const ids = new Set(visible.map(a => a.id));

        const local = this.audit.recent()
            .filter(e => (!e.agentId || ids.has(e.agentId)) && (since === undefined || Date.parse(e.ts) >= since))
            .map(e => ({ source: 'hermes', ...e }) as AuditRow);

        const unavailable: Array<{ agentId: string; reason: string }> = [];
        const remote = await Promise.all(visible.map(async a => {
            const port = a.connector.control?.();
            if (!port?.audit) { unavailable.push({ agentId: a.id, reason: 'no audit trail' }); return [] as AuditRow[]; }
            try {
                const rows = await port.audit({ ...(query.since ? { since: query.since } : {}) });
                return rows.map((e: AgentAuditEntry) => ({ source: a.id, ...e }) as AuditRow);
            } catch (err) {
                unavailable.push({ agentId: a.id, reason: (err as Error).message });
                return [] as AuditRow[];
            }
        }));
        const entries = [...local, ...remote.flat()].sort((x, y) => x.ts.localeCompare(y.ts));
        this.audit.record({ action: 'control', outcome: 'allowed', principalId: principal.id, capability: 'audit_view', ...(query.agentId ? { agentId: query.agentId } : {}) });
        return { entries: query.limit ? entries.slice(-query.limit) : entries, unavailable };
    }

    /** Finds the agent and its control port, checking who may do what: reading needs access to the agent, changing needs a control role. */
    private controlFor(principal: Principal, agentId: string, mode: 'read' | 'write'): { agent: FleetAgent; port: AgentControlPort } {
        const agent = this.agentFor(principal, agentId, 'control');
        if (mode === 'write') {
            const roles = agent.config.access?.controlRoles;
            if (!roles || !roles.some(r => principal.roles.includes(r))) {
                this.audit.record({ action: 'control', outcome: 'denied', principalId: principal.id, agentId, reason: 'control role' });
                throw new HermesError('FORBIDDEN', `${principal.id} may not change the execution of ${agentId}`);
            }
        }
        const port = agent.connector.control?.();
        if (!port) throw new HermesError('CONTROL_UNSUPPORTED', `${agentId} has no control channel configured`);
        return { agent, port };
    }

    private async callControl(principal: Principal, agentId: string, port: AgentControlPort, action: string, params: Record<string, unknown>, audited: boolean): Promise<unknown> {
        try {
            const out = await port.call(action, params);
            if (audited) {
                const version = (out as { version?: unknown } | undefined)?.version;
                this.audit.record({ action: 'control', outcome: 'allowed', principalId: principal.id, agentId, capability: action, ...(version !== undefined ? { reason: `policy version ${String(version)}` } : {}) });
            }
            return out;
        } catch (err) {
            const code = (err as { code?: string }).code;
            const known: HermesErrorCode[] = ['APPROVAL_REQUIRED', 'POLICY_WIDER_THAN_PARENT', 'CONTROL_UNSUPPORTED', 'INVALID_INPUT', 'FORBIDDEN'];
            const mapped: HermesErrorCode = known.includes(code as HermesErrorCode) ? code as HermesErrorCode : code === 'TASK_NOT_FOUND' ? 'RUN_NOT_FOUND' : 'AGENT_UNAVAILABLE';
            this.audit.record({ action: 'control', outcome: mapped === 'AGENT_UNAVAILABLE' ? 'failed' : 'denied', principalId: principal.id, agentId, capability: action, reason: `${code ?? 'error'}: ${(err as Error).message}` });
            throw new HermesError(mapped, `${agentId}.${action}: ${(err as Error).message}`);
        }
    }

    // ── Flows of other agents ───────────────────────────────────────────────

    /** The flows an agent hosts. Needs the right to use the agent. */
    async flowList(principal: Principal, agentId: string) {
        const agent = this.agentFor(principal, agentId, 'info');
        const port = this.flowPortOf(agent);
        return { agent: agentId, flows: await port.list().catch(err => { throw new HermesError('AGENT_UNAVAILABLE', `${agentId}: ${(err as Error).message}`); }) };
    }

    /**
     * Starts a flow on the agent that hosts it. A flow run is a run like any other (same roles, approval and store; the
     * capability is `flow:<name>`), so `agent_status`, `agent_result` and `agent_cancel` work on it too.
     */
    async flowRun(principal: Principal, request: { agentId: string; flow: string; input?: Record<string, unknown> }): Promise<RunView & { flowRunId: string }> {
        const capability = `flow:${request.flow}`;
        const agent = this.agentFor(principal, request.agentId, 'run', capability);
        const port = this.flowPortOf(agent);
        this.requireRoles(principal, agent, 'run', capability);
        if (agent.health.state === 'down') {
            this.audit.record({ action: 'run', outcome: 'denied', principalId: principal.id, agentId: agent.id, capability, reason: 'agent is down' });
            throw new HermesError('AGENT_UNAVAILABLE', `${agent.id} is down: ${agent.health.detail ?? 'no answer'}`);
        }
        const known = await port.list().catch(() => [] as Array<{ name: string }>);
        if (!known.some(f => f.name === request.flow)) throw new HermesError('CAPABILITY_NOT_FOUND', `${agent.id} has no flow "${request.flow}"`);
        const input = request.input ?? {};
        const inputPreview = this.mask(JSON.stringify(input), 500);
        await this.requireApproval({ action: 'run', principal, agentId: agent.id, capability, inputPreview }, this.approvalMode(agent, capability));

        const runId = randomUUID();
        await this.store.put({ runId, agentId: agent.id, capability, inputPreview, status: 'pending', principalId: principal.id, startedAt: new Date().toISOString() });
        let flowRunId: string;
        try { ({ flowRunId } = await port.start(request.flow, input)); }
        catch (err) {
            const message = (err as Error).message;
            await this.store.update(runId, { status: 'failed', error: message, finishedAt: new Date().toISOString() });
            this.audit.record({ action: 'run', outcome: 'failed', principalId: principal.id, agentId: agent.id, capability, runId, reason: message });
            throw new HermesError('RUN_FAILED', `${agent.id}.${capability}: ${message}`);
        }
        await this.store.update(runId, { status: 'running', connectorRunId: flowRunId });
        this.audit.record({ action: 'run', outcome: 'allowed', principalId: principal.id, agentId: agent.id, capability, runId });
        this.track(runId, this.flowHandle(port, flowRunId));
        return { ...view(this.store.get(runId)!), flowRunId };
    }

    /** Where a flow run is: its status, the step it is on and each step's state. */
    async flowStatus(principal: Principal, runId: string): Promise<{ runId: string; agentId: string; flow: FlowRunState }> {
        const { record, port } = this.flowRunOf(principal, runId);
        try { return { runId, agentId: record.agentId, flow: await port.status(record.connectorRunId!) }; }
        catch (err) { throw new HermesError('AGENT_UNAVAILABLE', `${record.agentId}: ${(err as Error).message}`); }
    }

    async flowPause(principal: Principal, runId: string) { return this.flowSteer(principal, runId, 'pause'); }

    async flowResume(principal: Principal, runId: string) { return this.flowSteer(principal, runId, 'resume'); }

    private async flowSteer(principal: Principal, runId: string, how: 'pause' | 'resume') {
        const { record, port, agent } = this.flowRunOf(principal, runId);
        this.requireRoles(principal, agent, 'run', record.capability);
        try {
            const flow = await port[how](record.connectorRunId!);
            this.audit.record({ action: 'control', outcome: 'allowed', principalId: principal.id, agentId: record.agentId, capability: `flow_${how}`, runId });
            return { runId, agentId: record.agentId, flow };
        } catch (err) {
            this.audit.record({ action: 'control', outcome: 'failed', principalId: principal.id, agentId: record.agentId, capability: `flow_${how}`, runId, reason: (err as Error).message });
            throw new HermesError('AGENT_UNAVAILABLE', `${record.agentId}: ${(err as Error).message}`);
        }
    }

    private flowPortOf(agent: FleetAgent): FlowPort {
        const port = agent.connector.flows?.();
        if (!port) throw new HermesError('CONTROL_UNSUPPORTED', `${agent.id} hosts no flows`);
        return port;
    }

    private flowRunOf(principal: Principal, runId: string): { record: RunRecord; port: FlowPort; agent: FleetAgent } {
        const record = this.recordFor(principal, runId);
        const agent = this.registry.get(record.agentId);
        const port = agent?.connector.flows?.();
        if (!record.capability.startsWith('flow:') || !record.connectorRunId || !agent || !port) throw new HermesError('RUN_NOT_FOUND', `"${runId}" is not a flow run`);
        return { record, port, agent };
    }

    /** A flow run followed like any other run: it ends when the flow reaches done, failed or cancelled. */
    private flowHandle(port: FlowPort, flowRunId: string, pollMs = 100): RunHandle {
        const terminal = (s: FlowRunState): RunOutcome | undefined => s.status === 'done' ? { status: 'done', output: s.output ?? '' }
            : s.status === 'failed' ? { status: 'failed', error: s.error ?? 'flow failed' } : s.status === 'cancelled' ? { status: 'cancelled' } : undefined;
        return {
            connectorRunId: flowRunId,
            status: async () => { const s = await port.status(flowRunId); return s.status === 'paused' ? 'running' : terminal(s)?.status ?? 'running'; },
            cancel: async () => { await port.cancel(flowRunId); },
            result: async () => {
                for (;;) {
                    const done = terminal(await port.status(flowRunId));
                    if (done) return done;
                    if (this.shutdown.signal.aborted) return { status: 'cancelled', error: 'stopped waiting' };
                    await new Promise<void>(r => { const t = setTimeout(r, pollMs); t.unref?.(); });
                }
            },
        };
    }

    // ── Creating agents, and what the fleet cannot do ───────────────────────

    /** Creates an agent from a blueprint of the operator's. The blueprint id is the whole request: see `Provisioning.create`. */
    async agentCreate(principal: Principal, request: { blueprint: string; label?: string; gapId?: string }) {
        const made = await this.provisioning.create(principal, { blueprintId: request.blueprint, ...(request.label ? { label: request.label } : {}), ...(request.gapId ? { gapId: request.gapId } : {}) });
        return { id: made.id, blueprint: made.blueprintId, expiresAt: made.expiresAt, state: this.registry.get(made.id)?.health.state };
    }

    /** Retires an agent Hermes created. An agent of the operator's own fleet cannot be retired this way. */
    async agentRetire(principal: Principal, instanceId: string) {
        const rec = await this.provisioning.retire(principal, instanceId);
        return { id: rec.id, status: rec.status, reason: rec.retiredReason };
    }

    /** The capabilities of the fleet that fit what is needed (words in common with their name, description and tags). */
    find(principal: Principal, need: string): Array<{ agentId: string; capability: string; score: number }> {
        const out: Array<{ agentId: string; capability: string; score: number }> = [];
        for (const a of this.registry.list()) {
            if (!this.mayUse(principal, a) || a.health.state === 'down') continue;
            for (const c of a.descriptor?.capabilities ?? []) {
                const score = matchScore(need, [c.name.replace(/[_-]/g, ' '), c.description, a.config.description ?? '', ...(a.config.tags ?? [])].join(' '));
                if (score > 0) out.push({ agentId: a.id, capability: c.name, score });
            }
        }
        return out.sort((x, y) => y.score - x.score);
    }

    /** Something needed that no agent of the fleet covers. See `Provisioning.reportGap`. */
    reportGap(principal: Principal, need: string) { return this.provisioning.reportGap(principal, need); }

    blueprintList(principal: Principal) { return this.provisioning.list(principal); }

    /** A draft blueprint, pending until an operator decides. */
    blueprintPropose(principal: Principal, blueprint: unknown, gapId?: string) { return this.provisioning.propose(principal, blueprint, gapId); }

    /**
     * An operator approves or rejects a draft. This is deliberately a method for the host to call with the operator's own
     * principal, not a tool: a model that could approve its own proposals would grant itself permissions.
     */
    blueprintDecide(principal: Principal, draftId: string, decision: 'approved' | 'rejected') { return this.provisioning.decide(principal, draftId, decision); }

    private async cancelRunsOf(agentId: string, reason: string): Promise<void> {
        for (const record of this.store.list({ agentId, status: [...ACTIVE] })) {
            const tracked = this.tracked.get(record.runId);
            await tracked?.handle.cancel(reason).catch(() => undefined);
            await this.settle(record.runId, { status: 'cancelled', error: reason });
        }
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
            if (record.capability.startsWith('flow:')) {
                const port = agent.connector.flows?.();
                if (!port || !record.connectorRunId) { await lost('the flow run did not outlive the Hermes process'); continue; }
                try {
                    const state = await port.status(record.connectorRunId);
                    if (state.status === 'running' || state.status === 'paused') this.track(record.runId, this.flowHandle(port, record.connectorRunId));
                    else await this.settle(record.runId, state.status === 'done' ? { status: 'done', output: state.output ?? '' } : state.status === 'failed' ? { status: 'failed', error: state.error ?? 'flow failed' } : { status: 'cancelled' });
                    this.audit.record({ action: 'reconcile', outcome: 'recovered', agentId: record.agentId, runId: record.runId });
                } catch (err) {
                    const e = err as { status?: number; code?: string };
                    if (e.status === 404 || e.code === 'RUN_NOT_FOUND' || e.code === 'TASK_NOT_FOUND') await lost('the agent does not know this flow run');
                    else this.audit.record({ action: 'reconcile', outcome: 'failed', agentId: record.agentId, runId: record.runId, reason: `could not ask the agent: ${(err as Error).message}` });
                }
                continue;
            }
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

    private agentFor(principal: Principal, agentId: string, action: 'run' | 'info' | 'control', capability?: string): FleetAgent {
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
        const auditAction = request.action === 'run' || request.action === 'cancel' ? request.action : request.action === 'agent_create' ? 'provision' : 'control';
        const base = { action: auditAction as 'run' | 'cancel' | 'control' | 'provision', principalId: request.principal.id, agentId: request.agentId, capability: request.capability } as const;
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
