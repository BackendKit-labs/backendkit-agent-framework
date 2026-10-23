import type { JobRegistry } from '../jobs/JobRegistry';
import type { SandboxDecision, SandboxRunner } from '../sandbox/types';

/**
 * Control of a running engine from outside (a supervisor such as Hermes), without core depending on any transport.
 * `EngineControl` has the same shape as `ControlHandler` of `@backendkit-labs/agent-protocol`, so it plugs straight
 * into `AgentServer`; the errors it raises carry the protocol `code` and are recognised by name.
 */

export type EngineControlAction = 'get_sandbox_policy' | 'set_sandbox_policy' | 'list_jobs' | 'cancel_job';

export interface EngineControlContext { tenantId?: string; traceId?: string; requestId?: string }

/** A refusal the caller should see with a specific protocol code. Recognised by `name` and `code`. */
export class EngineControlError extends Error {
    constructor(
        readonly code: 'INVALID_INPUT' | 'POLICY_WIDER_THAN_PARENT' | 'APPROVAL_REQUIRED' | 'TASK_NOT_FOUND' | 'CONTROL_UNSUPPORTED',
        message: string,
        readonly details?: unknown,
    ) {
        super(message);
        this.name = 'ControlError';
    }
}

/** What `review` concludes about a requested policy. An equal policy counts as `narrower`: it takes nothing away. */
export type PolicyReview =
    | { kind: 'invalid'; message: string }
    /** Wider than the operator's ceiling: no approval can grant it. */
    | { kind: 'beyond-ceiling'; message: string; details?: unknown }
    | { kind: 'narrower'; next: unknown }
    | { kind: 'wider'; next: unknown; details?: unknown };

/** The execution policy an engine runs under, seen as data. `@backendkit-labs/agent-sandbox` provides one. */
export interface PolicyControl {
    read(): { version: number; policy: unknown };
    review(candidate: unknown): PolicyReview;
    /** Puts `next` (as returned by `review`) in force; returns the new version. */
    apply(next: unknown): number;
}

export interface WideningRequest {
    /** What is in force now, and what is being asked. */
    from: unknown;
    to: unknown;
    details?: unknown;
    by?: string;
    context: EngineControlContext;
}

export interface ControlAuditEntry {
    ts: string;
    kind: 'control' | 'sandbox';
    agentId?: string;
    tool?: string;
    outcome: string;
    detail?: string;
    /** Who asked (`params.by`, else the tenant). */
    by?: string;
    /** Policy version in force after a policy change. */
    version?: number;
    traceId?: string;
}

export interface EngineControlOptions {
    policy?: PolicyControl;
    jobs?: JobRegistry;
    /**
     * Decides whether a policy WIDER than the one in force may be applied. Without it widening is refused
     * (`APPROVAL_REQUIRED`): control never widens on its own say-so. Narrowing never asks.
     */
    approveWidening?: (request: WideningRequest) => Promise<boolean> | boolean;
    /** Called with every audit entry as it is recorded (persist it where the host wants). */
    onAudit?: (entry: ControlAuditEntry) => void;
    /** Entries kept for `audit()`. Default 1000. */
    auditCapacity?: number;
}

export interface EngineControl {
    readonly actions: readonly EngineControlAction[];
    control(action: string, params: Record<string, unknown>, context: EngineControlContext): Promise<unknown>;
    audit(query: { since?: string; limit?: number }): Promise<ControlAuditEntry[]>;
    /** Stops recording sandbox decisions. */
    dispose(): void;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/**
 * Builds the control handler for an engine. `engine` is anything with a `sandbox` (an `AgentEngine`): its decisions are
 * recorded in the audit trail next to the control actions, which carry who asked and the policy version afterwards.
 */
export function createEngineControl(engine: { readonly sandbox?: SandboxRunner }, options: EngineControlOptions = {}): EngineControl {
    const capacity = options.auditCapacity ?? 1000;
    const trail: ControlAuditEntry[] = [];
    const record = (entry: Omit<ControlAuditEntry, 'ts'>) => {
        const full: ControlAuditEntry = { ts: new Date().toISOString(), ...entry };
        trail.push(full);
        if (trail.length > capacity) trail.splice(0, trail.length - capacity);
        try { options.onAudit?.(full); } catch { /* a persistence failure never blocks control */ }
    };

    const stop = engine.sandbox?.onDecision?.((d: SandboxDecision) => {
        record({ kind: 'sandbox', agentId: d.agentId, tool: d.tool, outcome: d.outcome, ...(d.reason ? { detail: d.reason } : {}) });
    });

    const actions: EngineControlAction[] = [];
    if (options.policy) actions.push('get_sandbox_policy', 'set_sandbox_policy');
    if (options.jobs) actions.push('list_jobs', 'cancel_job');

    // One policy change at a time: the review and the apply must see the same policy.
    let gate: Promise<unknown> = Promise.resolve();
    const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
        const run = gate.then(fn, fn);
        gate = run.catch(() => undefined);
        return run;
    };

    const who = (params: Record<string, unknown>, context: EngineControlContext) => {
        const by = str(params.by) ?? context.tenantId;
        return { ...(by ? { by } : {}), ...(context.traceId ? { traceId: context.traceId } : {}) };
    };

    const setPolicy = async (params: Record<string, unknown>, context: EngineControlContext) => {
        const port = options.policy!;
        const base = { kind: 'control' as const, tool: 'set_sandbox_policy', ...who(params, context) };
        if (!('policy' in params)) throw new EngineControlError('INVALID_INPUT', "set_sandbox_policy needs 'policy'");
        const current = port.read();
        if (params.expectedVersion !== undefined && params.expectedVersion !== current.version) {
            throw new EngineControlError('INVALID_INPUT', `expectedVersion ${String(params.expectedVersion)} does not match the policy in force (version ${current.version})`, { version: current.version });
        }
        const review = port.review(params.policy);
        if (review.kind === 'invalid') {
            record({ ...base, outcome: 'invalid', detail: review.message, version: current.version });
            throw new EngineControlError('INVALID_INPUT', review.message);
        }
        if (review.kind === 'beyond-ceiling') {
            record({ ...base, outcome: 'refused', detail: review.message, version: current.version });
            throw new EngineControlError('POLICY_WIDER_THAN_PARENT', review.message, review.details);
        }
        if (review.kind === 'wider') {
            const by = base.by;
            const approved = options.approveWidening
                ? await options.approveWidening({
                    from: current.policy, to: review.next, context,
                    ...(review.details !== undefined ? { details: review.details } : {}),
                    ...(by ? { by } : {}),
                })
                : false;
            if (!approved) {
                const detail = options.approveWidening ? 'widening was not approved' : 'widening needs approval and no approver is configured';
                record({ ...base, outcome: 'refused', detail, version: current.version });
                throw new EngineControlError('APPROVAL_REQUIRED', detail, review.details);
            }
        }
        const version = port.apply(review.next);
        record({ ...base, outcome: review.kind === 'wider' ? 'widened' : 'applied', version });
        return { version, policy: port.read().policy };
    };

    return {
        actions,

        async control(action, params, context) {
            switch (action) {
                case 'get_sandbox_policy':
                    if (options.policy) return options.policy.read();
                    break;
                case 'set_sandbox_policy':
                    if (options.policy) return exclusive(() => setPolicy(params, context));
                    break;
                case 'list_jobs':
                    if (options.jobs) {
                        const owner = str(params.owner);
                        const all = options.jobs.listAll();
                        return { jobs: owner ? all.filter(j => j.owner === owner) : all };
                    }
                    break;
                case 'cancel_job':
                    if (options.jobs) {
                        const id = str(params.id);
                        if (!id) throw new EngineControlError('INVALID_INPUT', "cancel_job needs 'id'");
                        const job = options.jobs.listAll().find(j => j.id === id);
                        if (!job) throw new EngineControlError('TASK_NOT_FOUND', `job ${id} not found`);
                        const cancelled = await options.jobs.cancel(id, job.owner);
                        record({ kind: 'control', tool: 'cancel_job', agentId: job.owner, outcome: cancelled ? 'cancelled' : 'not-running', detail: id, ...who(params, context) });
                        return { id, cancelled };
                    }
                    break;
            }
            throw new EngineControlError('CONTROL_UNSUPPORTED', `this engine does not support '${action}'`);
        },

        async audit(query) {
            const since = query.since ? Date.parse(query.since) : undefined;
            const rows = since === undefined ? trail : trail.filter(e => Date.parse(e.ts) >= since);
            return (query.limit ? rows.slice(-query.limit) : rows).map(e => ({ ...e }));
        },

        dispose() { stop?.(); },
    };
}
