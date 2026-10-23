import { existsSync, readFileSync } from 'node:fs';
import { checkNarrower, describeViolations, parsePolicyConfig } from '@backendkit-labs/agent-sandbox';
import type { SandboxPolicyConfig } from '@backendkit-labs/agent-sandbox';
import type { AuditLog } from '../audit';
import type { AgentConnector } from '../connectors/types';
import { HermesError, type ApprovalRequest, type HermesEvent, type Principal } from '../errors';
import type { FleetRegistry } from '../fleet/FleetRegistry';
import { blueprintSchema, checkBlueprint, problemText, type Blueprint, type ProvisioningPolicy } from '../fleet/provisioning';
import type { AgentConfig, ApprovalMode, FleetConfig } from '../fleet/schema';
import { AtomicFile } from '../store/atomicFile';

/** Builds the agent a blueprint describes. The host owns this: Hermes decides whether and with what limits, the host knows how. */
export type Provision = (blueprint: Blueprint, context: { instanceId: string; sandbox: SandboxPolicyConfig }) => AgentConnector | Promise<AgentConnector>;

export interface InstanceRecord {
    id: string;
    blueprintId: string;
    createdBy: string;
    createdAt: string;
    expiresAt?: string;
    status: 'live' | 'retired';
    retiredAt?: string;
    retiredReason?: string;
    /** The policy the instance was given (from its blueprint, after the inheritance check). */
    sandbox: unknown;
    gapId?: string;
    label?: string;
}

export interface DraftRecord {
    blueprint: Blueprint;
    status: 'pending' | 'approved' | 'rejected';
    proposedBy: string;
    proposedAt: string;
    gapId?: string;
    decidedBy?: string;
    decidedAt?: string;
}

export interface GapRecord {
    gapId: string;
    need: string;
    at: string;
    principalId: string;
    action: 'notified' | 'created' | 'create-failed' | 'propose';
    instanceId?: string;
    detail?: string;
}

interface State { counter: number; gapCounter: number; instances: Record<string, InstanceRecord>; drafts: Record<string, DraftRecord>; gaps: GapRecord[] }

export interface ProvisioningDeps {
    fleet: FleetConfig;
    registry: FleetRegistry;
    audit: AuditLog;
    provision?: Provision;
    stateFile?: string;
    /** Asks for approval the way every other action does: refuses when there is no approver. */
    approve(request: ApprovalRequest, mode: ApprovalMode): Promise<void>;
    /** Cancels the runs still going on an agent that is leaving the fleet. */
    cancelRunsOf(agentId: string, reason: string): Promise<void>;
    emit(event: HermesEvent): void;
    /** Capabilities of the fleet that fit `need`, for the principal. */
    find(principal: Principal, need: string): Array<{ agentId: string; capability: string }>;
}

const WORD = /[\p{L}\p{N}]{3,}/gu;
/** Words of a text, lower-cased, for matching a need against what something covers. */
/** Words that say nothing about what is needed (English and Spanish): matching on them would make everything cover everything. */
const STOP = new Set(('the and for with that this from into onto over under need needs needed want wants have has had are was were been being you your our all any can could should would will may might ' +
    'para que con los las una uno unos unas del por como pero sino necesito necesita necesitamos quiero quiere tiene tienen hay son ser está esta este estos estas ' +
    'todo toda todos todas').split(' '));
const words = (text: string): Set<string> => new Set((text.toLowerCase().match(WORD) ?? []).filter(w => !STOP.has(w)));
export function matchScore(need: string, text: string): number {
    const have = words(text);
    let n = 0;
    for (const w of words(need)) if (have.has(w)) n++;
    return n;
}

const hasRole = (principal: Principal, roles: string[] | undefined): boolean => !!roles && roles.some(r => principal.roles.includes(r));

export class Provisioning {
    private state: State = { counter: 0, gapCounter: 0, instances: {}, drafts: {}, gaps: [] };
    private readonly file?: AtomicFile;
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
    private creating = 0;
    private stopped = false;

    constructor(private readonly deps: ProvisioningDeps) {
        if (deps.stateFile) {
            this.file = new AtomicFile(deps.stateFile);
            if (existsSync(deps.stateFile)) this.state = { ...this.state, ...(JSON.parse(readFileSync(deps.stateFile, 'utf8')) as Partial<State>) };
        }
    }

    private get policy(): ProvisioningPolicy | undefined { return this.deps.fleet.policies?.provisioning; }
    private get mode(): 'notify' | 'create' | 'propose' { return this.policy?.gap?.mode ?? 'notify'; }

    /** Instances do not outlive the Hermes process that made them: whatever the last run left live is retired now. */
    async start(): Promise<void> {
        for (const rec of Object.values(this.state.instances)) {
            if (rec.status !== 'live') continue;
            rec.status = 'retired';
            rec.retiredAt = new Date().toISOString();
            rec.retiredReason = 'did not outlive the Hermes process';
            this.deps.audit.record({ action: 'provision', outcome: 'retired', instanceId: rec.id, blueprintId: rec.blueprintId, reason: rec.retiredReason });
        }
        await this.save();
    }

    async stop(): Promise<void> {
        this.stopped = true;
        for (const t of this.timers.values()) clearTimeout(t);
        this.timers.clear();
        await this.file?.flush();
    }

    // ── Blueprints ──────────────────────────────────────────────────────────

    /** The blueprints that can create agents: the operator's, and drafts an operator approved. Never a pending draft. */
    usable(): Blueprint[] {
        const approved = Object.values(this.state.drafts).filter(d => d.status === 'approved').map(d => d.blueprint);
        return [...(this.deps.fleet.blueprints ?? []), ...approved];
    }

    private blueprint(id: string): Blueprint | undefined { return this.usable().find(b => b.id === id); }

    /** What the principal may see: blueprints they can create from, and (for operators) the drafts waiting. */
    list(principal: Principal) {
        const operator = hasRole(principal, this.policy?.operatorRoles);
        return {
            blueprints: this.usable().filter(b => operator || hasRole(principal, b.createRoles)).map(b => ({
                id: b.id, description: b.description, template: b.template, tools: b.tools, covers: b.covers ?? [], approval: b.approval ?? 'ask',
                ...(b.limits?.ttlMinutes ? { ttlMinutes: b.limits.ttlMinutes } : {}),
            })),
            drafts: operator ? Object.values(this.state.drafts).filter(d => d.status === 'pending').map(d => ({ id: d.blueprint.id, proposedBy: d.proposedBy, gapId: d.gapId, tools: d.blueprint.tools, covers: d.blueprint.covers ?? [] })) : [],
            instances: Object.values(this.state.instances).filter(i => i.status === 'live').map(i => ({ id: i.id, blueprintId: i.blueprintId, expiresAt: i.expiresAt })),
        };
    }

    // ── Creating and retiring ───────────────────────────────────────────────

    /**
     * Creates an agent from a blueprint. The blueprint is the whole input: nothing the caller passes can change what the
     * instance is allowed to do. Order matters: who, what, whether it is within bounds, whether there is room, and only
     * then approval and the host's provisioner, so a refused creation never reaches either.
     */
    async create(principal: Principal, request: { blueprintId: string; label?: string; gapId?: string }): Promise<InstanceRecord> {
        const { blueprintId } = request;
        const base = { action: 'provision' as const, principalId: principal.id, blueprintId, ...(request.gapId ? { gapId: request.gapId } : {}) };
        const blueprint = this.blueprint(blueprintId);
        if (!blueprint) {
            this.deps.audit.record({ ...base, outcome: 'denied', reason: 'no such blueprint' });
            throw new HermesError('BLUEPRINT_NOT_FOUND', `no usable blueprint "${blueprintId}"`);
        }
        if (!hasRole(principal, blueprint.createRoles)) {
            this.deps.audit.record({ ...base, outcome: 'denied', reason: 'create role' });
            throw new HermesError('FORBIDDEN', `${principal.id} may not create agents from "${blueprintId}"`);
        }
        if (!this.deps.provision) throw new HermesError('CONTROL_UNSUPPORTED', 'this Hermes has no provisioner: it cannot create agents');

        const problems = checkBlueprint(blueprint, this.policy);
        if (problems.length) {
            this.deps.audit.record({ ...base, outcome: 'denied', reason: problemText(problems) });
            throw new HermesError('POLICY_WIDER_THAN_PARENT', `blueprint "${blueprintId}" is not within what Hermes may hand out: ${problemText(problems)}`, problems);
        }
        const maxLive = this.policy?.maxLive ?? 3;
        const live = Object.values(this.state.instances).filter(i => i.status === 'live').length;
        if (live + this.creating >= maxLive) {
            this.deps.audit.record({ ...base, outcome: 'denied', reason: `limit of ${maxLive} live agents` });
            throw new HermesError('LIMIT_REACHED', `${live} agents created by Hermes are live (limit ${maxLive})`);
        }

        this.creating++;
        try {
            const instanceId = this.nextId(blueprintId);
            await this.deps.approve(
                { action: 'agent_create', principal, agentId: instanceId, capability: blueprintId, inputPreview: `${blueprintId} (${blueprint.template}), tools: ${blueprint.tools.join(', ') || 'none'}` },
                blueprint.approval ?? 'ask',
            );

            const sandbox = parsePolicyConfig(blueprint.sandbox);
            let connector: AgentConnector;
            try { connector = await this.deps.provision(blueprint, { instanceId, sandbox }); }
            catch (err) {
                this.deps.audit.record({ ...base, outcome: 'failed', instanceId, reason: (err as Error).message });
                throw new HermesError('PROVISION_FAILED', `could not build "${blueprintId}": ${(err as Error).message}`);
            }
            await this.verifyBuilt(connector, instanceId, blueprintId, base);

            const config: AgentConfig = {
                id: instanceId,
                description: blueprint.description ?? `instance of ${blueprintId}`,
                connector: { kind: 'in-process' },
                tags: ['created', blueprintId],
                health: { intervalSec: 30 },
                access: { ...(blueprint.access ?? {}) },
            };
            await this.deps.registry.add(config, connector);

            const now = new Date();
            const ttl = blueprint.limits?.ttlMinutes;
            const rec: InstanceRecord = {
                id: instanceId, blueprintId, createdBy: principal.id, createdAt: now.toISOString(), status: 'live', sandbox,
                ...(ttl ? { expiresAt: new Date(now.getTime() + ttl * 60_000).toISOString() } : {}),
                ...(request.gapId ? { gapId: request.gapId } : {}),
                ...(request.label ? { label: request.label.slice(0, 80) } : {}),
            };
            this.state.instances[instanceId] = rec;
            if (ttl) this.expireAfter(instanceId, ttl * 60_000);
            await this.save();
            this.deps.audit.record({ ...base, outcome: 'created', instanceId, reason: `policy ${JSON.stringify(sandbox)}${ttl ? `, ttl ${ttl} min` : ''}` });
            this.deps.emit({ type: 'fleet.agent.created', instanceId, blueprintId, createdBy: principal.id, ...(request.gapId ? { gapId: request.gapId } : {}) });
            return { ...rec };
        } finally {
            this.creating--;
        }
    }

    /**
     * A buggy provisioner must not be able to hand out more than was checked: if the new agent can report the policy it
     * runs under, that policy has to be inside the creator's. Otherwise it is closed and nothing is registered.
     */
    private async verifyBuilt(connector: AgentConnector, instanceId: string, blueprintId: string, base: { action: 'provision'; principalId: string; blueprintId: string }): Promise<void> {
        const port = connector.control?.();
        if (!port?.actions.includes('get_sandbox_policy')) return;
        const creator = parsePolicyConfig(this.policy!.creator.sandbox);
        let reason: string | undefined;
        try {
            const read = await port.call('get_sandbox_policy', {}) as { policy?: unknown };
            const verdict = checkNarrower(creator, parsePolicyConfig(read.policy));
            if (!verdict.ok) reason = `the built agent runs wider than the creator: ${describeViolations(verdict.violations)}`;
        } catch (err) {
            reason = `could not read back the policy of the built agent: ${(err as Error).message}`;
        }
        if (reason) {
            await connector.close?.().catch(() => undefined);
            this.deps.audit.record({ ...base, outcome: 'denied', instanceId, reason });
            throw new HermesError('POLICY_WIDER_THAN_PARENT', `"${blueprintId}": ${reason}`);
        }
    }

    /** Retires an instance Hermes made: stops its runs, takes it out of the fleet, closes it. Only instances Hermes created. */
    async retire(principal: Principal, instanceId: string): Promise<InstanceRecord> {
        const rec = this.state.instances[instanceId];
        const blueprint = rec && this.blueprint(rec.blueprintId);
        if (!rec || rec.status !== 'live') throw new HermesError('AGENT_NOT_FOUND', `no live agent "${instanceId}" was created by Hermes`);
        if (!hasRole(principal, blueprint?.createRoles) && !hasRole(principal, this.policy?.operatorRoles)) {
            this.deps.audit.record({ action: 'provision', outcome: 'denied', principalId: principal.id, instanceId, blueprintId: rec.blueprintId, reason: 'create role' });
            throw new HermesError('FORBIDDEN', `${principal.id} may not retire ${instanceId}`);
        }
        return await this.retireInstance(instanceId, principal.id, 'retired');
    }

    private async retireInstance(instanceId: string, by: string, reason: string): Promise<InstanceRecord> {
        const rec = this.state.instances[instanceId];
        if (!rec || rec.status !== 'live') return rec;
        clearTimeout(this.timers.get(instanceId));
        this.timers.delete(instanceId);
        rec.status = 'retired';
        rec.retiredAt = new Date().toISOString();
        rec.retiredReason = reason;
        await this.deps.cancelRunsOf(instanceId, `agent ${instanceId} ${reason}`).catch(() => undefined);
        const agent = this.deps.registry.remove(instanceId);
        await agent?.connector.close?.().catch(() => undefined);
        await this.save();
        this.deps.audit.record({
            action: 'provision', outcome: reason === 'ttl expired' ? 'expired' : 'retired', principalId: by, instanceId, blueprintId: rec.blueprintId,
            ...(rec.gapId ? { gapId: rec.gapId } : {}), reason: `created by ${rec.createdBy}; ${reason}`,
        });
        this.deps.emit({ type: 'fleet.agent.retired', instanceId, blueprintId: rec.blueprintId, reason });
        return { ...rec };
    }

    private expireAfter(instanceId: string, ms: number): void {
        const timer = setTimeout(() => { if (!this.stopped) void this.retireInstance(instanceId, 'system', 'ttl expired'); }, ms);
        timer.unref?.();
        this.timers.set(instanceId, timer);
    }

    /** `<blueprint>-<n>`, never equal to an id of the operator's fleet or to a live agent. */
    private nextId(blueprintId: string): string {
        for (;;) {
            const id = `${blueprintId}-${++this.state.counter}`;
            if (!this.deps.registry.get(id) && !this.state.instances[id]) return id;
        }
    }

    // ── Gaps and drafts ─────────────────────────────────────────────────────

    /**
     * A task nobody in the fleet covers. Tells the host (`fleet.gap`) and then, by the company's choice, does nothing more
     * (`notify`, the default), creates from a blueprint that covers it (`create`, with that blueprint's own roles and
     * approval), or invites a draft (`propose`). A gap never grants anything by itself.
     */
    async reportGap(principal: Principal, need: string): Promise<GapRecord & { matches: Array<{ agentId: string; capability: string }>; gap: boolean }> {
        const matches = this.deps.find(principal, need);
        const gapId = `gap-${++this.state.gapCounter}`;
        if (matches.length) return { gapId, need, at: new Date().toISOString(), principalId: principal.id, action: 'notified', matches, gap: false };

        const mode = this.mode;
        const record: GapRecord = { gapId, need: need.slice(0, 500), at: new Date().toISOString(), principalId: principal.id, action: 'notified' };
        this.deps.audit.record({ action: 'gap', outcome: 'allowed', principalId: principal.id, gapId, reason: `${mode}: ${record.need}` });
        this.deps.emit({ type: 'fleet.gap', gapId, need: record.need, mode, principalId: principal.id });

        if (mode === 'create') {
            const best = this.usable().map(b => ({ b, score: matchScore(need, [...(b.covers ?? []), b.description ?? '', b.id].join(' ')) })).filter(x => x.score > 0).sort((x, y) => y.score - x.score)[0];
            if (best) {
                try {
                    const made = await this.create(principal, { blueprintId: best.b.id, gapId });
                    record.action = 'created';
                    record.instanceId = made.id;
                } catch (err) {
                    record.action = 'create-failed';
                    record.detail = `${(err as HermesError).code ?? 'error'}: ${(err as Error).message}`;
                }
            }
        } else if (mode === 'propose') {
            record.action = 'propose';
        }
        this.state.gaps.push(record);
        if (this.state.gaps.length > 500) this.state.gaps.splice(0, this.state.gaps.length - 500);
        await this.save();
        return { ...record, matches: [], gap: true };
    }

    /**
     * A draft blueprint: a proposal, not an authorization. It is checked against what Hermes may hand out now, stored as
     * pending, and cannot create anything until an operator approves it (and is checked again then).
     */
    async propose(principal: Principal, input: unknown, gapId?: string): Promise<DraftRecord> {
        if (this.mode !== 'propose') throw new HermesError('FORBIDDEN', 'this fleet does not let Hermes propose blueprints (policies.provisioning.gap.mode is not "propose")');
        const parsed = blueprintSchema.safeParse(input);
        if (!parsed.success) throw new HermesError('INVALID_INPUT', `not a blueprint: ${parsed.error.issues.map(i => `${i.path.join('.') || '$'}: ${i.message}`).join('; ')}`);
        const blueprint = parsed.data;
        if (this.usable().some(b => b.id === blueprint.id) || this.state.drafts[blueprint.id]?.status === 'pending') {
            throw new HermesError('INVALID_INPUT', `a blueprint "${blueprint.id}" already exists or is waiting`);
        }
        const pending = Object.values(this.state.drafts).filter(d => d.status === 'pending').length;
        if (pending >= (this.policy?.maxDrafts ?? 20)) throw new HermesError('LIMIT_REACHED', `${pending} drafts are already waiting for an operator`);
        const problems = checkBlueprint(blueprint, this.policy);
        if (problems.length) {
            this.deps.audit.record({ action: 'blueprint', outcome: 'denied', principalId: principal.id, blueprintId: blueprint.id, reason: problemText(problems), ...(gapId ? { gapId } : {}) });
            throw new HermesError('POLICY_WIDER_THAN_PARENT', `the draft is not within what Hermes may hand out: ${problemText(problems)}`, problems);
        }
        const draft: DraftRecord = { blueprint, status: 'pending', proposedBy: principal.id, proposedAt: new Date().toISOString(), ...(gapId ? { gapId } : {}) };
        this.state.drafts[blueprint.id] = draft;
        await this.save();
        this.deps.audit.record({ action: 'blueprint', outcome: 'proposed', principalId: principal.id, blueprintId: blueprint.id, ...(gapId ? { gapId } : {}) });
        this.deps.emit({ type: 'fleet.blueprint.proposed', draftId: blueprint.id, proposedBy: principal.id, ...(gapId ? { gapId } : {}) });
        return { ...draft };
    }

    /** An operator's decision. Not a model tool: only host code calls it, with the operator's own principal. */
    async decide(principal: Principal, draftId: string, decision: 'approved' | 'rejected'): Promise<DraftRecord> {
        if (!hasRole(principal, this.policy?.operatorRoles)) {
            this.deps.audit.record({ action: 'blueprint', outcome: 'denied', principalId: principal.id, blueprintId: draftId, reason: 'operator role' });
            throw new HermesError('FORBIDDEN', `${principal.id} is not an operator: it cannot decide drafts`);
        }
        const draft = this.state.drafts[draftId];
        if (!draft || draft.status !== 'pending') throw new HermesError('BLUEPRINT_NOT_FOUND', `no pending draft "${draftId}"`);
        if (decision === 'approved') {
            const problems = checkBlueprint(draft.blueprint, this.policy);
            if (problems.length) {
                this.deps.audit.record({ action: 'blueprint', outcome: 'denied', principalId: principal.id, blueprintId: draftId, reason: `no longer within bounds: ${problemText(problems)}` });
                throw new HermesError('POLICY_WIDER_THAN_PARENT', `the draft is no longer within what Hermes may hand out: ${problemText(problems)}`, problems);
            }
        }
        draft.status = decision;
        draft.decidedBy = principal.id;
        draft.decidedAt = new Date().toISOString();
        await this.save();
        this.deps.audit.record({ action: 'blueprint', outcome: decision === 'approved' ? 'approved' : 'rejected', principalId: principal.id, blueprintId: draftId, ...(draft.gapId ? { gapId: draft.gapId } : {}) });
        this.deps.emit({ type: 'fleet.blueprint.decided', draftId, decision, decidedBy: principal.id });
        return { ...draft };
    }

    gaps(): GapRecord[] { return this.state.gaps.map(g => ({ ...g })); }
    instances(): InstanceRecord[] { return Object.values(this.state.instances).map(i => ({ ...i })); }

    private save(): Promise<void> {
        return this.file ? this.file.write(JSON.stringify(this.state)) : Promise.resolve();
    }
}
