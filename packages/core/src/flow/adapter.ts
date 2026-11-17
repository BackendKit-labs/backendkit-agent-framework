import type { FlowDefinition } from './types';
import type { InProcessFlow, FlowRunView, FlowStatus, FlowStepView } from './host';
import type { JournalRun } from './journal';
import { runFlow } from './run';
import type { RunFlowOptions } from './run';

/**
 * Hosts a `FlowDefinition` in a `FlowHost` (SPEC-0023 F4): a supervisor (Hermes) then starts, watches, pauses, resumes and
 * cancels it through the protocol without knowing it is a core flow. The input of `start` is the flow payload. Pausing
 * holds the steps not yet started; cancelling aborts the ones running and starts no more.
 */
export function flowFromDefinition(def: FlowDefinition, opts: Omit<RunFlowOptions, 'payload' | 'signal' | 'checkpoint' | 'onTransition'>): InProcessFlow {
    return {
        steps: def.steps.map(s => s.id),
        run: async (input, control) => {
            const result = await runFlow(def, {
                ...opts,
                payload: input,
                signal: control.signal,
                checkpoint: control.checkpoint,
                onTransition: t => {
                    if (t.stepId.includes(':compensation')) return;
                    if (t.event === 'started') control.mark(t.stepId, 'running');
                    else if (t.event === 'completed') control.mark(t.stepId, 'done');
                    else if (t.event === 'failed') control.mark(t.stepId, 'failed', t.detail);
                    else if (t.event === 'skipped') control.mark(t.stepId, 'skipped');
                    else if (t.event === 'rejected') control.mark(t.stepId, 'failed', 'rejected');
                },
            });
            if (result.status === 'cancelled') return undefined; // the host already reports it as cancelled
            if (result.status !== 'completed') {
                const bad = Object.values(result.steps).find(s => s.status === 'failed' || s.status === 'rejected');
                throw new Error(bad ? `step "${bad.stepId}" ${bad.status}${bad.error ? `: ${bad.error}` : ''}` : `flow ${result.status}`);
            }
            const last = def.steps[def.steps.length - 1];
            return result.steps[last.id]?.content ?? '';
        },
    };
}

/**
 * Projects a journal record to the `FlowRunState` vocabulary of protocol 1.1 (SPEC-0023 §4.1): `awaiting_approval` shows as
 * `paused` and `lost` as `failed`, with the reason in `detail`/`error`, until the protocol grows those states.
 * `stepOrder` (the flow's step ids) gives the steps their declared order.
 */
export function flowRunView(run: JournalRun, stepOrder?: string[]): FlowRunView {
    const status: FlowStatus = run.status === 'awaiting_approval' ? 'paused' : run.status === 'lost' ? 'failed' : run.status;
    const ids = [...new Set([...(stepOrder ?? []), ...Object.keys(run.steps)])];
    const steps: FlowStepView[] = ids.map((name): FlowStepView => {
        const j = run.steps[name];
        if (!j) return { name, status: 'pending' };
        if (j.status === 'awaiting_approval') return { name, status: 'running', detail: 'awaiting approval' };
        if (j.status === 'interrupted') return { name, status: 'failed', detail: j.error ?? 'interrupted' };
        return { name, status: j.status, ...(j.error ? { detail: j.error } : {}) };
    });
    const current = run.waiting?.stepId ?? steps.find(s => s.status === 'running')?.name;
    const last = stepOrder?.length ? run.steps[stepOrder[stepOrder.length - 1]] : undefined;
    return {
        flowRunId: run.runId,
        flow: run.flow,
        status,
        ...(current ? { currentStep: current } : {}),
        steps,
        startedAt: run.startedAt,
        ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
        ...(status === 'done' && last?.output !== undefined ? { output: last.output } : {}),
        ...(run.status === 'lost' ? { error: 'lost' } : run.error ? { error: run.error } : {}),
    };
}
