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
import { ComplianceGate, ComplianceGateError } from './ComplianceGate';
import type { GateRecord } from './ComplianceGate.js';

/** Something that learns from the outcome of each gate: `EnterpriseLearning` (or the deprecated `EnterpriseReflection`). */
export interface GateOutcomeRecorder {
    recordGateOutcome(record: GateRecord): Promise<unknown>;
}

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
    /** An audit sink (a `HashChainAuditSink`) that receives every event of every compliance gate of the run. */
    gateAudit?: import('@backendkit-labs/agent-core').AuditSink;
    /**
     * Called for steps with `gate.approval: human`. Receives the flow step
     * (including its gate definition) and the outputs of its dependencies.
     * Return false to reject the step and abort dependents. Without it such a step is rejected (ADR-0010).
     */
    onApprovalRequired?: (
        step: FlowStep,
        previousOutputs: Record<string, string>,
    ) => Promise<boolean>;
    /**
     * Called after a step executes successfully when the step has a gate with
     * `criteria` defined. Receives the pre-built `ComplianceGate` (already
     * configured with executor, evidenceMode, and criteria from the YAML), the
     * flow step, and the step's output.
     *
     * The callback must evaluate each criterion via `gate.evaluateCriterion()`.
     * When it returns, `gate.verdict` is checked:
     * - `'passed'` → step proceeds
     * - anything else → step is marked failed
     *
     * A step whose gate declares `criteria` needs this callback and an `evaluator`; without them the step fails
     * with a `ComplianceGateError` (a declared gate is never skipped silently), unless the gate is a human approval
     * (`approval: human`): then the person is the evaluation and the criteria are shown to them. `allowUnevaluatedGates` restores
     * the old behaviour of letting such a step through.
     */
    onGateRequired?: (
        gate: ComplianceGate,
        step: FlowStep,
        stepOutput: string,
    ) => Promise<void>;
    /**
     * Let a step through whose gate declares `criteria` but cannot be evaluated (no `evaluator` in the flow, or no
     * `onGateRequired` here). Default: false, the step fails. Transitional: use it only while you wire the evaluation.
     */
    allowUnevaluatedGates?: boolean;
    /** Observer for the append-only transition log. */
    onTransition?: (transition: FlowTransition) => void;
    /**
     * Cable 1: enterprise reflection adapter.
     * When set, every ComplianceGate outcome (pass AND fail) is recorded in the
     * failure catalog so recurring failures can be promoted to deterministic rules.
     */
    reflection?: GateOutcomeRecorder;
    /**
     * Stable identifier for this run. Used in gate records persisted to the vault.
     * Auto-generated when not provided.
     */
    runId?: string;
}

export class FlowRunner {
    private readonly transitions: FlowTransition[] = [];

    constructor(
        private readonly def: FlowDefinition,
        private readonly opts: FlowRunOptions,
    ) {}

    async run(): Promise<FlowResult> {
        const stepsById = new Map(this.def.steps.map(s => [s.id, s]));
        const runId = this.opts.runId ?? `run-${Date.now()}`;

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

                    // ── ComplianceGate evaluation ────────────────────────────
                    const flowStep = stepsById.get(stepId!);
                    const gate = flowStep?.gate;
                    if (gate?.criteria?.length && gate.approval !== 'human' && !(gate.evaluator && this.opts.onGateRequired) && !this.opts.allowUnevaluatedGates) {
                        this.record({ stepId: stepId!, event: 'gate_failed', detail: 'gate cannot be evaluated' });
                        throw new ComplianceGateError(
                            `gate for step "${stepId}" declares criteria but cannot be evaluated ` +
                            `(${gate.evaluator ? 'no onGateRequired callback' : 'no evaluator in the flow'}): refusing to let the step through`,
                        );
                    }
                    if (gate?.criteria?.length && gate.evaluator && this.opts.onGateRequired) {
                        this.record({ stepId: stepId!, event: 'gate_evaluation_started' });
                        const complianceGate = new ComplianceGate({
                            stepId: stepId!,
                            flowId: this.def.flow,
                            runId,
                            executor: agentId,
                            criteria: gate.criteria,
                            evidenceMode: gate.evidence ?? 'optional',
                            ...(this.opts.gateAudit ? { audit: this.opts.gateAudit } : {}),
                        });
                        await this.opts.onGateRequired(complianceGate, flowStep!, result.content);

                        // ── Cable 1: record outcome in enterprise reflection ───
                        // Fires for BOTH pass and fail — failures feed the catalog,
                        // passes build the "no incidents" signal used by demotion.
                        if (this.opts.reflection) {
                            this.opts.reflection
                                .recordGateOutcome(complianceGate.getRecord())
                                .catch(() => { /* best-effort — never blocks the flow */ });
                        }
                        // ──────────────────────────────────────────────────────

                        if (complianceGate.verdict !== 'passed') {
                            this.record({
                                stepId: stepId!,
                                event: 'gate_failed',
                                detail: `verdict: ${complianceGate.verdict}`,
                            });
                            throw new ComplianceGateError(
                                `gate for step "${stepId}" did not pass — verdict: ${complianceGate.verdict}`,
                            );
                        }
                        this.record({ stepId: stepId!, event: 'gate_passed' });
                    }
                    // ────────────────────────────────────────────────────────

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
                // No one to ask is a rejection, never an approval (ADR-0010); only a literal `true` approves.
                if (!this.opts.onApprovalRequired) {
                    this.record({ stepId: coreStep.id, event: 'rejected', detail: 'no approver: pass onApprovalRequired' });
                    return false;
                }
                let approved = false;
                try { approved = (await this.opts.onApprovalRequired(flowStep!, previousOutputs)) === true; }
                catch { /* an approver that fails does not approve */ }
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
