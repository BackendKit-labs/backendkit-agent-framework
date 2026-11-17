/**
 * Declarative flow definitions: business flows as data, not code (SPEC-0023).
 *
 * A FlowDefinition is loaded from YAML (or built by a planner), validated, and executed by a flow engine. Adding a flow
 * for a company means writing a YAML file and no platform code.
 *
 * Gate semantics (criteria/evaluator/evidence) are parsed and carried here so the format is stable; their enforcement
 * belongs to whoever evaluates the gate (`ComplianceGate` in `agent-enterprise` is one).
 */

import { z } from 'zod';

// ── Schemas ───────────────────────────────────────────────────────────────────

export const FlowTriggerSchema = z.object({
    /** How the flow is started. `manual` = invoked programmatically. */
    type: z.enum(['queue', 'webhook', 'cron', 'manual']),
    /** Queue name — required when type is `queue`. */
    queue: z.string().optional(),
    /** Route path — required when type is `webhook`. */
    path: z.string().optional(),
    /** Cron expression — required when type is `cron`. */
    schedule: z.string().optional(),
});

export const FlowGateSchema = z.object({
    /** Verifiable completion criteria, evaluated one by one (ComplianceGate). */
    criteria: z.array(z.string()).default([]),
    /** Agent that evaluates the criteria. MUST differ from the executing agent. */
    evaluator: z.string().optional(),
    /** Whether each criterion requires attached evidence to pass. */
    evidence: z.enum(['required', 'optional']).default('optional'),
    /** `human` pauses the step until a human approves (core ApprovalGate). */
    approval: z.enum(['human', 'none']).default('none'),
});

export const FlowStepSchema = z.object({
    id: z.string().min(1),
    /** Agent id that executes this step. */
    agent: z.string().min(1),
    /** Prompt for the agent. Supports `{{payload}}` and `{{payload.path.to.field}}`. */
    prompt: z.string().min(1),
    /** Tools the agent may use in this step (informational until engine-level scoping). */
    tools: z.array(z.string()).optional(),
    /** Step ids this step waits for. Steps with no `after` run in parallel. */
    after: z.array(z.string()).default([]),
    gate: FlowGateSchema.optional(),
});

export const FlowCompensationSchema = z.object({
    /** Failure selector: `<stepId>.failed`. */
    on: z.string().regex(/^[\w-]+\.failed$/, 'must be "<stepId>.failed"'),
    agent: z.string().min(1),
    /** Prompt for the compensating agent. Supports payload interpolation. */
    prompt: z.string().min(1),
});

export const FlowDefinitionSchema = z.object({
    flow: z.string().min(1),
    version: z.number().int().positive().default(1),
    trigger: FlowTriggerSchema,
    steps: z.array(FlowStepSchema).min(1),
    compensation: z.array(FlowCompensationSchema).default([]),
});

// ── Types ─────────────────────────────────────────────────────────────────────

export type FlowTrigger      = z.infer<typeof FlowTriggerSchema>;
export type FlowGate         = z.infer<typeof FlowGateSchema>;
export type FlowStep         = z.infer<typeof FlowStepSchema>;
export type FlowCompensation = z.infer<typeof FlowCompensationSchema>;
export type FlowDefinition   = z.infer<typeof FlowDefinitionSchema>;

// ── Transitions ───────────────────────────────────────────────────────────────

export type FlowTransitionEvent =
    | 'started'
    | 'completed'
    | 'failed'
    | 'skipped'
    | 'rejected'
    | 'approval_requested'
    | 'gate_evaluation_started'
    | 'gate_passed'
    | 'gate_failed'
    | 'compensation_started'
    | 'compensation_completed'
    | 'compensation_failed';

/** Append-only execution record — every state mutation produces one. */
export interface FlowTransition {
    at: string;
    stepId: string;
    event: FlowTransitionEvent;
    detail?: string;
}
