import type { Transport } from '../transport/Transport';
import type {
    WorkflowDef,
    WorkflowResult,
    WorkflowRunOptions,
    WorkflowStepDef,
    WorkflowStepResult,
} from './types';

type AgentRunner = (agentId: string, input: string, context?: string) => Promise<{ content: string }>;

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
            }

            // Guard: cycle detection in builder should prevent this, but be safe
            if (runnable.length === 0 && remaining.size > 0) break;

            // Remove from remaining before executing so the while condition is correct
            for (const step of runnable) remaining.delete(step.id);

            await this.executeWave(runnable, results, completed, failed);
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

        await Promise.all(parallel.map(s => this.executeOne(s, results, completed, failed)));

        for (const step of needApproval) {
            await this.executeOne(step, results, completed, failed);
        }
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
            const { content } = await this.opts.runAgent(step.agentId, step.input, context);
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
