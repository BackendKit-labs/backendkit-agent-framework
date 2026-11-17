import { FlowDefinitionSchema } from './types';
import type { FlowDefinition } from './types';

/**
 * Plans and static flows as `FlowDefinition` (SPEC-0023 F6a). A plan a planner generates and a flow written in YAML are the same
 * object once converted: both run on `runFlow`. The inputs are structural types, so core needs no planner or orchestrator package.
 *
 * `gate: true` is a person reviewing the step's OUTPUT (`gate.approval: 'human'`); run it with `approvals.when: 'after'`.
 * `gate_criteria` only count when the step is gated, as before.
 */

export interface PlanStepLike {
    id: string;
    agent_id: string;
    task: string;
    depends_on?: string[];
    gate?: boolean;
    gate_criteria?: string[];
    timeout_ms?: number;
}

export interface TaskPlanLike {
    summary: string;
    subtasks: PlanStepLike[];
}

export interface StaticFlowLike {
    id: string;
    name?: string;
    version?: number;
    steps: Array<{
        id: string;
        agent: string;
        task: string;
        depends_on?: string[];
        gate?: boolean;
        gate_criteria?: string[];
    }>;
}

function gateOf(gate: boolean | undefined, criteria: string[] | undefined): { gate?: FlowDefinition['steps'][number]['gate'] } {
    return gate ? { gate: { criteria: criteria ?? [], evidence: 'optional', approval: 'human' } } : {};
}

/** A plan generated for one task: an ephemeral flow with a manual trigger. */
export function flowFromTaskPlan(plan: TaskPlanLike, opts: { flow?: string; version?: number } = {}): FlowDefinition {
    return FlowDefinitionSchema.parse({
        flow: opts.flow ?? (plan.summary.trim() || 'plan'),
        version: opts.version ?? 1,
        trigger: { type: 'manual' },
        steps: plan.subtasks.map(s => ({
            id: s.id, agent: s.agent_id, prompt: s.task, after: s.depends_on ?? [],
            ...gateOf(s.gate, s.gate_criteria),
            ...(s.timeout_ms !== undefined ? { timeoutMs: s.timeout_ms } : {}),
        })),
    });
}

/** A flow file of the orchestrator (`flows/*.yaml`, already parsed). `{{payload.key}}` placeholders pass through unchanged. */
export function flowFromStaticFlow(f: StaticFlowLike, opts: { trigger?: FlowDefinition['trigger'] } = {}): FlowDefinition {
    return FlowDefinitionSchema.parse({
        flow: f.id,
        version: f.version ?? 1,
        trigger: opts.trigger ?? { type: 'manual' },
        steps: f.steps.map(s => ({
            id: s.id, agent: s.agent, prompt: s.task, after: s.depends_on ?? [],
            ...gateOf(s.gate, s.gate_criteria),
        })),
    });
}
