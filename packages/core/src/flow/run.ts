import type { Transport } from '../transport/Transport';
import type { FlowDefinition, FlowStep, FlowTransition } from './types';
import type { ConcurrencyLimiter } from './limiter';
import { interpolate } from './interpolate';

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

export type FlowRunStatus = 'completed' | 'failed' | 'rejected' | 'cancelled';

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
    /** Asks a person for a step with `gate.approval: human`. Default: approve. False rejects the step and what depends on it. */
    approve?: (step: FlowStep, previousOutputs: Record<string, string>) => Promise<boolean>;
    /** After a step succeeds and has a `gate`: throw to fail the step (a gate is never skipped silently). */
    gate?: (step: FlowStep, output: string, ctx: GateContext) => Promise<void>;
    onTransition?: (t: FlowTransition) => void;
}

const DEFAULT_MAX_CONCURRENCY = 8;

export async function runFlow(def: FlowDefinition, opts: RunFlowOptions): Promise<FlowResult> {
    const runId = opts.runId ?? `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const transitions: FlowTransition[] = [];
    const record = (stepId: string, event: FlowTransition['event'], detail?: string): void => {
        const t: FlowTransition = { at: new Date().toISOString(), stepId, event, ...(detail !== undefined ? { detail } : {}) };
        transitions.push(t);
        opts.onTransition?.(t);
    };
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    if (opts.signal?.aborted) controller.abort(); else opts.signal?.addEventListener('abort', onAbort, { once: true });

    const results: Record<string, FlowStepResult> = {};
    const completed = new Set<string>();
    const failed = new Set<string>();
    const remaining = new Set(def.steps.map(s => s.id));

    opts.transport?.emit({ type: 'workflow_start', name: def.flow });

    const executeOne = async (step: FlowStep): Promise<void> => {
        const prev: Record<string, string> = {};
        for (const dep of step.after) if (results[dep]?.status === 'completed') prev[dep] = results[dep].content;

        if (step.gate?.approval === 'human') {
            opts.transport?.emit({ type: 'workflow_approval_required', step: step.id });
            record(step.id, 'approval_requested');
            const ok = await (opts.approve?.(step, prev) ?? Promise.resolve(true));
            if (!ok) {
                record(step.id, 'rejected');
                results[step.id] = { stepId: step.id, agentId: step.agent, content: '', status: 'rejected' };
                failed.add(step.id);
                return;
            }
        }

        const releases: Array<() => void> = [];
        try {
            await opts.checkpoint?.();
            if (controller.signal.aborted) return; // not started: left out of the results, the run is cancelled
            if (opts.limiter) {
                releases.push(await opts.limiter.acquire(step.agent, controller.signal));
                if (opts.tenantId) releases.push(await opts.limiter.acquire(`tenant:${opts.tenantId}`, controller.signal));
            }
            opts.transport?.emit({ type: 'workflow_step_start', step: step.id, agent: step.agent });
            record(step.id, 'started');
            const context = Object.keys(prev).length > 0
                ? Object.entries(prev).map(([id, out]) => `[${id}]:\n${out}`).join('\n\n')
                : undefined;
            const out = await opts.executor.run(step, {
                prompt: interpolate(step.prompt, opts.payload),
                context,
                idempotencyKey: `${runId}:${step.id}:1`,
                signal: controller.signal,
            });
            if (step.gate && opts.gate) {
                await opts.gate(step, out.content, { runId, flow: def.flow, record: (e, d) => record(step.id, e, d) });
            }
            results[step.id] = {
                stepId: step.id, agentId: step.agent, content: out.content, status: 'completed',
                ...(out.costUsd !== undefined ? { costUsd: out.costUsd } : {}),
            };
            completed.add(step.id);
            record(step.id, 'completed');
            opts.transport?.emit({ type: 'workflow_step_complete', step: step.id, success: true });
        } catch (err) {
            // Cancelled while running or waiting for a slot: the step did not fail, the run was stopped.
            if (controller.signal.aborted) return;
            const error = err instanceof Error ? err.message : String(err);
            results[step.id] = { stepId: step.id, agentId: step.agent, content: '', status: 'failed', error };
            failed.add(step.id);
            record(step.id, 'failed', error);
            opts.transport?.emit({ type: 'workflow_step_complete', step: step.id, success: false });
        } finally {
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
            const runnable = def.steps.filter(s =>
                remaining.has(s.id) && s.after.every(d => completed.has(d)) && !s.after.some(d => failed.has(d)));
            const blocked = def.steps.filter(s => remaining.has(s.id) && s.after.some(d => failed.has(d)));

            for (const step of blocked) {
                results[step.id] = { stepId: step.id, agentId: step.agent, content: '', status: 'skipped' };
                remaining.delete(step.id);
                failed.add(step.id); // transitive
                record(step.id, 'skipped');
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
    if (!cancelled) {
        // Unsatisfiable (cycle or unknown step in a definition that skipped validation): report it, do not drop it.
        for (const id of remaining) {
            const step = def.steps.find(s => s.id === id)!;
            const error = 'Unsatisfiable dependencies (cycle or unknown step)';
            results[id] = { stepId: id, agentId: step.agent, content: '', status: 'failed', error };
            record(id, 'failed', error);
        }
    }

    const compensations: FlowCompensationResult[] = [];
    if (!cancelled) {
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
        : vals.some(r => r.status === 'rejected') ? 'rejected'
        : vals.some(r => r.status === 'failed') ? 'failed'
        : 'completed';
    opts.transport?.emit({ type: 'workflow_complete', name: def.flow, status: status === 'cancelled' ? 'failed' : status });
    return { runId, flow: def.flow, version: def.version, status, steps: results, transitions, compensations };
}
