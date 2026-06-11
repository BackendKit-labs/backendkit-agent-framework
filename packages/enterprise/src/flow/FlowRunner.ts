/**
 * FlowRunner — executes a FlowDefinition on top of the core WorkflowRunner.
 *
 * Adds on top of core:
 * - `{{payload}}` / `{{payload.path.to.field}}` interpolation into prompts
 * - append-only transition log (every state change produces a FlowTransition)
 * - compensation steps that run when their `on: <stepId>.failed` selector matches
 * - gate `approval: human` mapped to core's requireApproval mechanism
 *
 * Gate criteria/evaluator enforcement arrives with ComplianceGate (fase 2);
 * here they are carried through and exposed to the approval callback.
 */

import {
    WorkflowBuilder,
    WorkflowRunner,
    agent as agentRef,
} from '@backendkit-labs/agent-core';
import type { Transport } from '@backendkit-labs/agent-core';
import {
    FlowDefinition,
    FlowStep,
    FlowResult,
    FlowStepResult,
    FlowTransition,
    FlowCompensationResult,
} from './types';

export type FlowAgentRunner = (
    agentId: string,
    input: string,
    context?: string,
    stepId?: string,
) => Promise<{ content: string }>;

export interface FlowRunOptions {
    /** Trigger payload, interpolated into step prompts. */
    payload?: unknown;
    runAgent: FlowAgentRunner;
    transport: Transport;
    /**
     * Called for steps with `gate.approval: human`. Receives the flow step
     * (including its gate definition) and the outputs of its dependencies.
     * Return false to reject the step and abort dependents.
     */
    onApprovalRequired?: (
        step: FlowStep,
        previousOutputs: Record<string, string>,
    ) => Promise<boolean>;
    /** Observer for the append-only transition log. */
    onTransition?: (transition: FlowTransition) => void;
}

export class FlowRunner {
    private readonly transitions: FlowTransition[] = [];

    constructor(
        private readonly def: FlowDefinition,
        private readonly opts: FlowRunOptions,
    ) {}

    async run(): Promise<FlowResult> {
        const stepsById = new Map(this.def.steps.map(s => [s.id, s]));

        // ── Build the core workflow with interpolated prompts ────────────────
        const builder = new WorkflowBuilder(this.def.flow);
        for (const step of this.def.steps) {
            builder.step(step.id, agentRef(step.agent), {
                input: interpolate(step.prompt, this.opts.payload),
                dependsOn: step.after,
                requireApproval: step.gate?.approval === 'human',
            });
        }

        const runner = new WorkflowRunner(builder.build(), {
            transport: this.opts.transport,
            runAgent: async (agentId, input, context, stepId) => {
                this.record({ stepId: stepId ?? '?', event: 'started' });
                try {
                    const result = await this.opts.runAgent(agentId, input, context, stepId);
                    this.record({ stepId: stepId ?? '?', event: 'completed' });
                    return result;
                } catch (err) {
                    this.record({
                        stepId: stepId ?? '?',
                        event: 'failed',
                        detail: err instanceof Error ? err.message : String(err),
                    });
                    throw err;
                }
            },
            onApprovalRequired: async (coreStep, previousOutputs) => {
                this.record({ stepId: coreStep.id, event: 'approval_requested' });
                const flowStep = stepsById.get(coreStep.id);
                const approved = await (
                    this.opts.onApprovalRequired?.(flowStep!, previousOutputs) ?? Promise.resolve(true)
                );
                if (!approved) {
                    this.record({ stepId: coreStep.id, event: 'rejected' });
                }
                return approved;
            },
        });

        const workflowResult = await runner.run();

        // ── Record terminal states the runner doesn't surface via callbacks ──
        for (const result of Object.values(workflowResult.steps)) {
            if (result.status === 'skipped') {
                this.record({ stepId: result.stepId, event: 'skipped' });
            }
        }

        // ── Compensation for failed steps ─────────────────────────────────────
        const compensations = await this.runCompensations(workflowResult.steps);

        return {
            flow: this.def.flow,
            version: this.def.version,
            status: workflowResult.status,
            steps: workflowResult.steps as Record<string, FlowStepResult>,
            transitions: [...this.transitions],
            compensations,
        };
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private async runCompensations(
        steps: Record<string, FlowStepResult>,
    ): Promise<FlowCompensationResult[]> {
        const results: FlowCompensationResult[] = [];

        for (const comp of this.def.compensation) {
            const stepId = comp.on.replace(/\.failed$/, '');
            if (steps[stepId]?.status !== 'failed') continue;

            this.record({ stepId, event: 'compensation_started', detail: `agent: ${comp.agent}` });
            try {
                const { content } = await this.opts.runAgent(
                    comp.agent,
                    interpolate(comp.prompt, this.opts.payload),
                    `Failed step "${stepId}": ${steps[stepId].error ?? 'unknown error'}`,
                    `${stepId}:compensation`,
                );
                results.push({ on: comp.on, agent: comp.agent, status: 'completed', content });
                this.record({ stepId, event: 'compensation_completed' });
            } catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                results.push({ on: comp.on, agent: comp.agent, status: 'failed', error });
                this.record({ stepId, event: 'compensation_failed', detail: error });
            }
        }

        return results;
    }

    private record(t: Omit<FlowTransition, 'at'>): void {
        const transition: FlowTransition = { at: new Date().toISOString(), ...t };
        this.transitions.push(transition);
        this.opts.onTransition?.(transition);
    }
}

// ── Interpolation ─────────────────────────────────────────────────────────────

/**
 * Replaces `{{payload}}` and `{{payload.a.b}}` with values from the payload.
 * Objects are JSON-stringified; missing paths render as `null`.
 */
export function interpolate(template: string, payload: unknown): string {
    return template.replace(/\{\{\s*payload((?:\.[\w-]+)*)\s*\}\}/g, (_match, pathStr: string) => {
        const value = pathStr
            ? pathStr.slice(1).split('.').reduce<unknown>(
                (acc, key) => (acc as Record<string, unknown> | undefined)?.[key],
                payload,
              )
            : payload;
        if (value === undefined || value === null) return 'null';
        return typeof value === 'string' ? value : JSON.stringify(value);
    });
}
