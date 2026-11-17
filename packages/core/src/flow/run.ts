import type { Transport } from '../transport/Transport';
import type { FlowDefinition, FlowStep, FlowTransition } from './types';
import type { ConcurrencyLimiter } from './limiter';
import { interpolate } from './interpolate';
import { decideStepApproval } from './approval';
import { describeCondition, evaluateCondition } from './condition';
import type { FlowApprovals } from './approval';
import type { RunJournal, JournalRun } from './journal';

/**
 * The flow engine (SPEC-0023 F2): runs a `FlowDefinition` in waves (steps whose `after` are done run together, up to
 * `maxConcurrency`), skips what depends on a failure, then runs the compensations. How a step is executed is not its
 * concern: that is the `StepExecutor` (one agent, a remote worker, a queue).
 */

export interface StepOutput { content: string; costUsd?: number }

export interface StepInput {
    prompt: string;
    /** Outputs of the steps this one waits for, as `[id]:\n<output>` blocks. */
    context?: string;
    /** `runId:stepId:attempt`: a step with an external effect uses it to be safe when run again (at-least-once). */
    idempotencyKey: string;
    signal: AbortSignal;
}

export interface StepExecutor {
    run(step: FlowStep, input: StepInput): Promise<StepOutput>;
}

/** `awaiting_approval`: a step waits for a person; resolve the approval and run again with the same `runId` to continue. */
export type FlowRunStatus = 'completed' | 'failed' | 'rejected' | 'cancelled' | 'awaiting_approval';

export interface FlowStepResult {
    stepId: string;
    agentId: string;
    content: string;
    status: 'completed' | 'failed' | 'skipped' | 'rejected';
    error?: string;
    costUsd?: number;
}

export interface FlowCompensationResult {
    on: string;
    agent: string;
    status: 'completed' | 'failed';
    content?: string;
    error?: string;
}

export interface FlowResult {
    runId: string;
    flow: string;
    version: number;
    status: FlowRunStatus;
    steps: Record<string, FlowStepResult>;
    /** Sum of the `costUsd` the steps reported. Absent when none did. */
    costUsd?: number;
    transitions: FlowTransition[];
    compensations: FlowCompensationResult[];
}

export interface GateContext {
    runId: string;
    flow: string;
    /** Appends to the transition log (`gate_passed`, `gate_failed`...). */
    record(event: FlowTransition['event'], detail?: string): void;
}

export interface RunFlowOptions {
    executor: StepExecutor;
    /** Trigger payload, interpolated into prompts as `{{payload.x}}`. */
    payload?: unknown;
    runId?: string;
    /** Most steps of one wave at the same time. Default 8. */
    maxConcurrency?: number;
    /** Caps per `step.agent` (and per `tenantId`, if given) across every flow that shares the limiter. */
    limiter?: ConcurrencyLimiter;
    tenantId?: string;
    /** Abort to stop: running steps get the signal, steps not started are not started, the result is `cancelled`. */
    signal?: AbortSignal;
    /** Awaited before each step starts: a supervisor holds it while the flow is paused (`FlowControl.checkpoint`). */
    checkpoint?: () => Promise<void>;
    /** Transport for `workflow_*` events, as `WorkflowRunner` emits. */
    transport?: Transport;
    /** Approval through the `ApprovalStore` (F5); replaces `approve`. A step can stop the run as `awaiting_approval`. */
    approvals?: FlowApprovals;
    /** Asks a person for a step with `gate.approval: human`. Default: approve. False rejects the step and what depends on it. */
    approve?: (step: FlowStep, previousOutputs: Record<string, string>) => Promise<boolean>;
    /** After a step succeeds and has a `gate`: throw to fail the step (a gate is never skipped silently). */
    gate?: (step: FlowStep, output: string, ctx: GateContext) => Promise<void>;
    onTransition?: (t: FlowTransition) => void;
    /** What a failed step means for the steps that wait for it: `skip` (default) skips them; `continue` runs them without its output. The run still ends `failed`. */
    onStepFailure?: 'skip' | 'continue';
    /** Deadline for every step that has no `timeoutMs` of its own. A step that exceeds it fails (and its signal aborts) without holding up the others. Default: none. */
    stepTimeoutMs?: number;
    /**
     * Durable state (SPEC-0023 F3). With a journal the run is claimed (one process per run), each step is written before and
     * after it runs, and a `runId` that already has a record is RESUMED: steps that are `done` are not run again and their
     * output feeds the next ones. The payload is not stored: pass it again when resuming.
     */
    journal?: RunJournal;
    /** Who holds the claim. Default: a random id per call. */
    owner?: string;
    /** How long the claim lasts without being renewed. Default 10 minutes. */
    claimTtlMs?: number;
    /**
     * How often the run renews its claim while it goes on, so that a run longer than `claimTtlMs` is not taken over by another
     * process while it is alive: the claim then only expires when this process stops (dies, stalls). Default a third of the TTL;
     * 0 turns renewal off (tests that simulate a process that died). If a renewal finds the claim taken by someone else, the run is
     * stopped and `runFlow` throws `FlowClaimError`; the journal is left as the new owner found it.
     */
    claimRenewMs?: number;
    /** A step the journal shows as `running` (the process died in it): run it again (default, at least once; the idempotency key carries the attempt) or fail it. */
    onInterrupted?: 'retry' | 'fail';
    /** Applied to the input preview and error texts written to the journal. Outputs are stored as they are. */
    redact?: (text: string) => string;
}

/** Another process holds the claim of the run. */
export class FlowClaimError extends Error {
    constructor(readonly runId: string) { super(`run "${runId}" is held by another owner`); this.name = 'FlowClaimError'; }
}

const DEFAULT_MAX_CONCURRENCY = 8;

const DEFAULT_CLAIM_TTL_MS = 10 * 60_000;
const PREVIEW_CHARS = 200;

export async function runFlow(def: FlowDefinition, opts: RunFlowOptions): Promise<FlowResult> {
    const runId = opts.runId ?? `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const journal = opts.journal;
    if (!journal) return execute(def, opts, runId, undefined);

    const owner = opts.owner ?? `owner-${Math.random().toString(36).slice(2, 10)}`;
    const ttl = opts.claimTtlMs ?? DEFAULT_CLAIM_TTL_MS;
    let release = await journal.claim(runId, owner, ttl);
    if (!release) throw new FlowClaimError(runId);

    // Renew the claim while the run lives: it expires only when this process stops. If someone else holds it by the time we
    // renew, the run is no longer ours: stop it and leave the journal to the new owner. Each renewal's release replaces the last
    // (the old one no longer matches what the journal holds).
    const state = { lost: false };
    const stop = new AbortController();
    const forward = (): void => stop.abort();
    if (opts.signal?.aborted) stop.abort(); else opts.signal?.addEventListener('abort', forward, { once: true });
    const renewMs = opts.claimRenewMs ?? Math.floor(ttl / 3);
    let renewing = false;
    const timer = renewMs > 0 ? setInterval(() => {
        if (renewing) return;
        renewing = true;
        journal.claim(runId, owner, ttl)
            .then(next => { if (next) release = next; else { state.lost = true; stop.abort(); } })
            .catch(() => undefined) // a journal that cannot be reached now may answer at the next tick
            .finally(() => { renewing = false; });
    }, renewMs) : undefined;
    timer?.unref?.();
    try {
        const prior = await journal.get(runId);
        if (prior && prior.flow !== def.flow) throw new Error(`run "${runId}" belongs to flow "${prior.flow}", not "${def.flow}"`);
        if (prior && (prior.status === 'done' || prior.status === 'cancelled')) return fromJournal(prior, def);
        if (!prior) {
            const raw = opts.payload === undefined ? '' : (typeof opts.payload === 'string' ? opts.payload : JSON.stringify(opts.payload));
            const cut = raw.length > PREVIEW_CHARS ? `${raw.slice(0, PREVIEW_CHARS)}…` : raw;
            await journal.begin({ runId, flow: def.flow, inputPreview: opts.redact ? opts.redact(cut) : cut, ...(opts.tenantId ? { tenantId: opts.tenantId } : {}) });
        } else {
            await journal.update(runId, { status: 'running' });
        }
        const result = await execute(def, { ...opts, signal: stop.signal }, runId, prior, state);
        if (state.lost) throw new FlowClaimError(runId);
        return result;
    } finally {
        if (timer) clearInterval(timer);
        opts.signal?.removeEventListener('abort', forward);
        if (!state.lost) await release().catch(() => undefined);
    }
}

/** A run that already finished, as the result `runFlow` would have returned. */
function fromJournal(run: JournalRun, def: FlowDefinition): FlowResult {
    const steps: Record<string, FlowStepResult> = {};
    for (const s of def.steps) {
        const j = run.steps[s.id];
        if (!j) continue;
        steps[s.id] = {
            stepId: s.id, agentId: s.agent, content: j.output ?? '',
            status: j.status === 'done' ? 'completed' : j.status === 'skipped' ? 'skipped' : 'failed',
            ...(j.error !== undefined ? { error: j.error } : {}),
            ...(j.costUsd !== undefined ? { costUsd: j.costUsd } : {}),
        };
    }
    return {
        runId: run.runId, flow: run.flow, version: def.version,
        status: run.status === 'done' ? 'completed' : run.status === 'cancelled' ? 'cancelled' : 'failed',
        steps, ...(run.costUsd !== undefined ? { costUsd: run.costUsd } : {}), transitions: run.transitions, compensations: [],
    };
}

async function execute(def: FlowDefinition, opts: RunFlowOptions, runId: string, prior: JournalRun | undefined, claim?: { lost: boolean }): Promise<FlowResult> {
    const journal = opts.journal;
    const redact = (s: string): string => (opts.redact ? opts.redact(s) : s);
    const transitions: FlowTransition[] = [];
    let pending: FlowTransition[] = [];
    /** Transitions not yet written travel with the next journal write. */
    const flush = (): FlowTransition[] | undefined => { const p = pending; pending = []; return p.length ? p : undefined; };
    const record = (stepId: string, event: FlowTransition['event'], detail?: string): void => {
        const t: FlowTransition = { at: new Date().toISOString(), stepId, event, ...(detail !== undefined ? { detail } : {}) };
        transitions.push(t);
        pending.push(t);
        opts.onTransition?.(t);
    };
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    if (opts.signal?.aborted) controller.abort(); else opts.signal?.addEventListener('abort', onAbort, { once: true });

    const results: Record<string, FlowStepResult> = {};
    const completed = new Set<string>();
    const failed = new Set<string>();
    /** Steps not run because their condition did not hold, and what waits for them: skipped, but the flow did not fail. */
    const unmet = new Set<string>();
    const remaining = new Set(def.steps.map(s => s.id));
    /** Steps that stopped for approval: the run is suspended, not failed. */
    const awaiting = new Map<string, string>();

    // Resume: what the journal shows as done is not run again; its output feeds the steps that follow.
    if (prior) {
        for (const s of def.steps) {
            const j = prior.steps[s.id];
            if (j?.status === 'done') {
                results[s.id] = {
                    stepId: s.id, agentId: s.agent, content: j.output ?? '', status: 'completed',
                    ...(j.costUsd !== undefined ? { costUsd: j.costUsd } : {}),
                };
                completed.add(s.id);
                remaining.delete(s.id);
            } else if (j?.status === 'running' && opts.onInterrupted === 'fail') {
                const error = 'interrupted: the process stopped while this step was running';
                results[s.id] = { stepId: s.id, agentId: s.agent, content: '', status: 'failed', error };
                failed.add(s.id);
                remaining.delete(s.id);
                record(s.id, 'failed', error);
                await journal?.step(runId, s.id, { status: 'interrupted', error, transitions: flush() });
            }
        }
    }

    opts.transport?.emit({ type: 'workflow_start', name: def.flow });

    const approvalsWhen = opts.approvals?.when ?? 'before';

    /**
     * Asks for approval of a step through the `ApprovalStore`. Returns true to go on. On false the step has been settled here
     * (rejected, denied) or left waiting (`awaiting_approval`, with `output` kept in the journal when the review is after the step).
     */
    const settleApproval = async (step: FlowStep, prev: Record<string, string>, output?: string): Promise<boolean> => {
        let verdict;
        try {
            verdict = await decideStepApproval(opts.approvals!, def.flow, runId, step, prev, output);
        } catch (err) {
            verdict = { kind: 'denied' as const, reason: err instanceof Error ? err.message : String(err) };
        }
        if (verdict.kind === 'proceed') return true;
        if (verdict.kind === 'pending') {
            opts.transport?.emit({ type: 'workflow_approval_required', step: step.id });
            record(step.id, 'approval_requested', verdict.approvalId);
            awaiting.set(step.id, verdict.approvalId);
            await journal?.step(runId, step.id, {
                status: 'awaiting_approval', ...(output !== undefined ? { output } : {}), transitions: flush(),
            }).catch(() => undefined);
            return false;
        }
        const rejected = verdict.kind === 'rejected';
        record(step.id, rejected ? 'rejected' : 'failed', verdict.reason);
        await journal?.step(runId, step.id, { status: 'failed', error: redact(verdict.reason), transitions: flush() }).catch(() => undefined);
        results[step.id] = {
            stepId: step.id, agentId: step.agent, content: '', status: rejected ? 'rejected' : 'failed',
            ...(rejected ? {} : { error: verdict.reason }),
        };
        failed.add(step.id);
        return false;
    };

    const executeOne = async (step: FlowStep): Promise<void> => {
        const prev: Record<string, string> = {};
        for (const dep of step.after) if (results[dep]?.status === 'completed') prev[dep] = results[dep].content;

        // A condition is checked before anything else, so that no approval is asked for a step that will not run.
        if (step.when) {
            const seen = results[step.when.step];
            const text = describeCondition(step.when);
            const holds = seen?.status === 'completed' ? evaluateCondition(step.when, seen.content) : undefined;
            if (holds !== true) {
                const detail = holds === undefined ? `condition not evaluable (${step.when.step} produced no output): ${text}` : `condition not met: ${text}`;
                results[step.id] = { stepId: step.id, agentId: step.agent, content: '', status: 'skipped' };
                unmet.add(step.id);
                record(step.id, 'skipped', detail);
                await journal?.step(runId, step.id, { status: 'skipped', transitions: flush() }).catch(() => undefined);
                opts.transport?.emit({ type: 'workflow_step_complete', step: step.id, success: true });
                return;
            }
        }

        if (opts.approvals) {
            if (approvalsWhen === 'before' && !(await settleApproval(step, prev))) return;
        } else if (step.gate?.approval === 'human') {
            opts.transport?.emit({ type: 'workflow_approval_required', step: step.id });
            record(step.id, 'approval_requested');
            const ok = await (opts.approve?.(step, prev) ?? Promise.resolve(true));
            if (!ok) {
                record(step.id, 'rejected');
                await journal?.step(runId, step.id, { status: 'failed', error: 'rejected', transitions: flush() }).catch(() => undefined);
                results[step.id] = { stepId: step.id, agentId: step.agent, content: '', status: 'rejected' };
                failed.add(step.id);
                return;
            }
        }

        // A step whose output was already produced and is only waiting for its review is not run again.
        const reviewed = opts.approvals && approvalsWhen === 'after' && prior?.steps[step.id]?.status === 'awaiting_approval'
            ? prior.steps[step.id].output : undefined;

        let attempt = prior?.steps[step.id]?.attempt ?? 0;
        const releases: Array<() => void> = [];
        let timer: ReturnType<typeof setTimeout> | undefined;
        let unlink: (() => void) | undefined;
        try {
            await opts.checkpoint?.();
            if (controller.signal.aborted) return; // not started: left out of the results, the run is cancelled
            let out: StepOutput;
            if (reviewed !== undefined) {
                out = { content: reviewed };
            } else {
                if (opts.limiter) {
                    releases.push(await opts.limiter.acquire(step.agent, controller.signal));
                    if (opts.tenantId) releases.push(await opts.limiter.acquire(`tenant:${opts.tenantId}`, controller.signal));
                }
                opts.transport?.emit({ type: 'workflow_step_start', step: step.id, agent: step.agent });
                record(step.id, 'started');
                attempt += 1;
                // Written BEFORE the step runs; if the journal cannot write, the step does not run (fails closed).
                await journal?.step(runId, step.id, { status: 'running', attempt, transitions: flush() });
                const context = Object.keys(prev).length > 0
                    ? Object.entries(prev).map(([id, o]) => `[${id}]:\n${o}`).join('\n\n')
                    : undefined;
                // The step's own signal: aborted by the run or by the step's deadline, so a timeout stops only this step.
                const stepCtl = new AbortController();
                const link = (): void => stepCtl.abort();
                controller.signal.addEventListener('abort', link, { once: true });
                unlink = () => controller.signal.removeEventListener('abort', link);
                const pendingRun = opts.executor.run(step, {
                    prompt: interpolate(step.prompt, opts.payload),
                    context,
                    idempotencyKey: `${runId}:${step.id}:${attempt}`,
                    signal: stepCtl.signal,
                });
                const limitMs = step.timeoutMs ?? opts.stepTimeoutMs;
                if (limitMs === undefined) {
                    out = await pendingRun;
                } else {
                    pendingRun.catch(() => undefined); // a late rejection after the deadline is already accounted for
                    const deadline = new Promise<never>((_, reject) => {
                        timer = setTimeout(() => { stepCtl.abort(); reject(new Error(`timed out after ${limitMs}ms`)); }, limitMs);
                    });
                    out = await Promise.race([pendingRun, deadline]);
                }
                if (step.gate && opts.gate) {
                    await opts.gate(step, out.content, { runId, flow: def.flow, record: (e, d) => record(step.id, e, d) });
                }
                if (opts.approvals && approvalsWhen === 'after') {
                    // The output is produced and kept; the review decides whether the steps that follow may use it.
                    await journal?.step(runId, step.id, { status: 'running', attempt, output: out.content });
                }
            }
            if (opts.approvals && approvalsWhen === 'after' && !(await settleApproval(step, prev, out.content))) return;
            record(step.id, 'completed');
            await journal?.step(runId, step.id, {
                status: 'done', output: out.content, attempt,
                ...(out.costUsd !== undefined ? { costUsd: out.costUsd } : {}), transitions: flush(),
            });
            results[step.id] = {
                stepId: step.id, agentId: step.agent, content: out.content, status: 'completed',
                ...(out.costUsd !== undefined ? { costUsd: out.costUsd } : {}),
            };
            completed.add(step.id);
            opts.transport?.emit({ type: 'workflow_step_complete', step: step.id, success: true });
        } catch (err) {
            // Cancelled while running or waiting for a slot: the step did not fail, the run was stopped.
            if (controller.signal.aborted) return;
            const error = err instanceof Error ? err.message : String(err);
            results[step.id] = { stepId: step.id, agentId: step.agent, content: '', status: 'failed', error };
            // `continue`: the steps that follow still run (they get no output from this one).
            if (opts.onStepFailure === 'continue') completed.add(step.id); else failed.add(step.id);
            record(step.id, 'failed', error);
            await journal?.step(runId, step.id, { status: 'failed', error: redact(error), transitions: flush() }).catch(() => undefined);
            opts.transport?.emit({ type: 'workflow_step_complete', step: step.id, success: false });
        } finally {
            if (timer) clearTimeout(timer);
            unlink?.();
            for (const r of releases.reverse()) r();
        }
    };

    const runLimited = async (items: FlowStep[]): Promise<void> => {
        const limit = Math.max(1, opts.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY);
        let next = 0;
        const worker = async (): Promise<void> => {
            while (next < items.length) await executeOne(items[next++]);
        };
        await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    };

    try {
        while (remaining.size > 0 && !controller.signal.aborted) {
            const stopped = (d: string): boolean => failed.has(d) || unmet.has(d);
            const runnable = def.steps.filter(s =>
                remaining.has(s.id) && s.after.every(d => completed.has(d)) &&!s.after.some(stopped));
            const blocked = def.steps.filter(s => remaining.has(s.id) && s.after.some(stopped));

            for (const step of blocked) {
                results[step.id] = { stepId: step.id, agentId: step.agent, content: '', status: 'skipped' };
                remaining.delete(step.id);
                // transitive; a step stopped only by an unmet condition does not make the flow fail
                if (step.after.some(d => failed.has(d))) failed.add(step.id); else unmet.add(step.id);
                record(step.id, 'skipped');
                await journal?.step(runId, step.id, { status: 'skipped', transitions: flush() }).catch(() => undefined);
            }
            if (runnable.length === 0) {
                if (blocked.length > 0) continue;
                break;
            }
            for (const step of runnable) remaining.delete(step.id);

            // Human-approval steps go one at a time after the parallel ones of the wave, as WorkflowRunner does.
            await runLimited(runnable.filter(s => s.gate?.approval !== 'human'));
            for (const step of runnable.filter(s => s.gate?.approval === 'human')) await executeOne(step);
        }
    } finally {
        opts.signal?.removeEventListener('abort', onAbort);
    }

    const cancelled = controller.signal.aborted;
    const suspended = !cancelled && awaiting.size > 0;
    if (!cancelled && !suspended) {
        // Unsatisfiable (cycle or unknown step in a definition that skipped validation): report it, do not drop it.
        for (const id of remaining) {
            const step = def.steps.find(s => s.id === id)!;
            const error = 'Unsatisfiable dependencies (cycle or unknown step)';
            results[id] = { stepId: id, agentId: step.agent, content: '', status: 'failed', error };
            record(id, 'failed', error);
        }
    }

    const compensations: FlowCompensationResult[] = [];
    if (!cancelled && !suspended) {
        for (const comp of def.compensation) {
            const stepId = comp.on.replace(/\.failed$/, '');
            if (results[stepId]?.status !== 'failed') continue;
            record(stepId, 'compensation_started', `agent: ${comp.agent}`);
            try {
                const out = await opts.executor.run(
                    { id: `${stepId}:compensation`, agent: comp.agent, prompt: comp.prompt, after: [] },
                    {
                        prompt: interpolate(comp.prompt, opts.payload),
                        context: `Failed step "${stepId}": ${results[stepId].error ?? 'unknown error'}`,
                        idempotencyKey: `${runId}:${stepId}:compensation:1`,
                        signal: controller.signal,
                    },
                );
                compensations.push({ on: comp.on, agent: comp.agent, status: 'completed', content: out.content });
                record(stepId, 'compensation_completed');
            } catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                compensations.push({ on: comp.on, agent: comp.agent, status: 'failed', error });
                record(stepId, 'compensation_failed', error);
            }
        }
    }

    const vals = Object.values(results);
    const status: FlowRunStatus = cancelled ? 'cancelled'
        : suspended ? 'awaiting_approval'
        : vals.some(r => r.status === 'rejected') ? 'rejected'
        : vals.some(r => r.status === 'failed') ? 'failed'
        : 'completed';
    // The run was taken over while it went on: whatever the new owner finds in the journal is what stands.
    if (claim?.lost) return { runId, flow: def.flow, version: def.version, status: 'cancelled', steps: results, transitions, compensations };
    const costUsd = vals.some(r => r.costUsd !== undefined) ? vals.reduce((a, r) => a + (r.costUsd ?? 0), 0) : undefined;
    await journal?.update(runId, {
        status: status === 'completed' ? 'done' : status === 'cancelled' ? 'cancelled' : status === 'awaiting_approval' ? 'awaiting_approval' : 'failed',
        ...(suspended ? { waiting: { stepId: [...awaiting.keys()][0], approvalId: [...awaiting.values()][0] } } : { waiting: null }),
        ...(status === 'rejected' ? { error: 'rejected' } : {}),
        ...(costUsd !== undefined ? { costUsd } : {}),
        transitions: flush(),
    });
    opts.transport?.emit({ type: 'workflow_complete', name: def.flow, status: status === 'completed' ? 'completed' : status === 'rejected' ? 'rejected' : 'failed' });
    return { runId, flow: def.flow, version: def.version, status, steps: results, ...(costUsd !== undefined ? { costUsd } : {}), transitions, compensations };
}
