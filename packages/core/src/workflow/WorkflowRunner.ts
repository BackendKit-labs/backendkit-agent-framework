import type { Transport } from '../transport/Transport';
import type {
    WorkflowDef,
    WorkflowResult,
    WorkflowRunOptions,
    WorkflowStepDef,
    WorkflowStepResult,
} from './types';

const DEFAULT_MAX_CONCURRENCY = 8;

type AgentRunner = (agentId: string, input: string, context?: string, stepId?: string) => Promise<{ content: string }>;

interface WorkflowRunnerOptions extends WorkflowRunOptions {
    runAgent: AgentRunner;
    transport: Transport;
}

export class WorkflowRunner {
    constructor(
        private readonly def: WorkflowDef,
        private readonly opts: WorkflowRunnerOptions,
    ) {}

    async run(): Promise<WorkflowResult> {
        this.opts.transport.emit({ type: 'workflow_start', name: this.def.name });

        const results: Record<string, WorkflowStepResult> = {};
        const completed = new Set<string>();
        const failed = new Set<string>();
        const remaining = new Set(this.def.steps.map(s => s.id));

        while (remaining.size > 0) {
            // Steps whose dependencies are all satisfied and none failed
            const runnable = this.def.steps.filter(s =>
                remaining.has(s.id) &&
                s.dependsOn.every(dep => completed.has(dep)) &&
                !s.dependsOn.some(dep => failed.has(dep)),
            );

            // Steps that can never run because a dependency failed → skip them
            const blocked = this.def.steps.filter(s =>
                remaining.has(s.id) &&
                s.dependsOn.some(dep => failed.has(dep)),
            );

            for (const step of blocked) {
                results[step.id] = {
                    stepId: step.id,
                    agentId: step.agentId,
                    content: '',
                    status: 'skipped',
                };
                remaining.delete(step.id);
                // Transitive: whatever depends on a skipped step can never run either
                failed.add(step.id);
            }

            if (runnable.length === 0) {
                if (blocked.length > 0) continue; // newly skipped steps may block the next level
                break;
            }

            // Remove from remaining before executing so the while condition is correct
            for (const step of runnable) remaining.delete(step.id);

            await this.executeWave(runnable, results, completed, failed);
        }

        // Anything left can never run: a cycle or a dependency on an unknown step (a raw WorkflowDef
        // skips the builder's validation). Report it instead of dropping it from the result.
        for (const id of remaining) {
            const step = this.def.steps.find(s => s.id === id)!;
            results[id] = {
                stepId: id,
                agentId: step.agentId,
                content: '',
                status: 'failed',
                error: 'Unsatisfiable dependencies (cycle or unknown step)',
            };
        }

        const anyRejected = Object.values(results).some(r => r.status === 'rejected');
        const anyFailed = Object.values(results).some(r => r.status === 'failed');
        const status = anyRejected ? 'rejected' : anyFailed ? 'failed' : 'completed';

        this.opts.transport.emit({ type: 'workflow_complete', name: this.def.name, status });
        return { name: this.def.name, status, steps: results };
    }

    // ── Private ────────────────────────────────────────────────────────────────

    /** Execute one wave: approval steps sequentially after parallel steps. */
    private async executeWave(
        steps: WorkflowStepDef[],
        results: Record<string, WorkflowStepResult>,
        completed: Set<string>,
        failed: Set<string>,
    ): Promise<void> {
        const parallel = steps.filter(s => !s.requireApproval);
        const needApproval = steps.filter(s => s.requireApproval);

        await this.runLimited(parallel, s => this.executeOne(s, results, completed, failed));

        for (const step of needApproval) {
            await this.executeOne(step, results, completed, failed);
        }
    }

    /** Runs `fn` over `items` with at most `maxConcurrency` in flight; `fn` never rejects (executeOne handles its errors). */
    private async runLimited<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
        const limit = Math.max(1, this.opts.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY);
        let next = 0;
        const worker = async (): Promise<void> => {
            while (next < items.length) await fn(items[next++]);
        };
        await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    }

    private async executeOne(
        step: WorkflowStepDef,
        results: Record<string, WorkflowStepResult>,
        completed: Set<string>,
        failed: Set<string>,
    ): Promise<void> {
        const prevOutputs = this.collectOutputs(step, results);

        if (step.requireApproval) {
            this.opts.transport.emit({ type: 'workflow_approval_required', step: step.id });
            const approved = await (this.opts.onApprovalRequired?.(step, prevOutputs) ?? Promise.resolve(true));
            if (!approved) {
                results[step.id] = { stepId: step.id, agentId: step.agentId, content: '', status: 'rejected' };
                failed.add(step.id);
                return;
            }
        }

        this.opts.transport.emit({ type: 'workflow_step_start', step: step.id, agent: step.agentId });

        const context = Object.keys(prevOutputs).length > 0
            ? Object.entries(prevOutputs).map(([id, out]) => `[${id}]:\n${out}`).join('\n\n')
            : undefined;

        try {
            const { content } = await this.opts.runAgent(step.agentId, step.input, context, step.id);
            results[step.id] = { stepId: step.id, agentId: step.agentId, content, status: 'completed' };
            completed.add(step.id);
            this.opts.transport.emit({ type: 'workflow_step_complete', step: step.id, success: true });
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            results[step.id] = { stepId: step.id, agentId: step.agentId, content: '', status: 'failed', error };
            failed.add(step.id);
            this.opts.transport.emit({ type: 'workflow_step_complete', step: step.id, success: false });
        }
    }

    /** Collect outputs from completed direct dependencies. */
    private collectOutputs(
        step: WorkflowStepDef,
        results: Record<string, WorkflowStepResult>,
    ): Record<string, string> {
        const out: Record<string, string> = {};
        for (const dep of step.dependsOn) {
            if (results[dep]?.status === 'completed') out[dep] = results[dep].content;
        }
        return out;
    }
}
