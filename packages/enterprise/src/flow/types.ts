/**
 * Declarative flow definitions — business flows as data, not code.
 *
 * A FlowDefinition is loaded from YAML, validated, and executed on top of
 * the core WorkflowRunner. Adding a new business flow for a company means
 * writing a YAML file — zero platform code.
 *
 * Gate semantics (criteria/evaluator/evidence) are parsed and carried here
 * so the YAML format is stable; their enforcement lands with ComplianceGate
 * (design doc: diseno-multiagente-enterprise.md, fase 2).
 */

import { z } from '@backendkit-labs/agent-core';

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

// ── Execution types ───────────────────────────────────────────────────────────

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

export interface FlowCompensationResult {
    on: string;
    agent: string;
    status: 'completed' | 'failed';
    content?: string;
    error?: string;
}

export interface FlowStepResult {
    stepId: string;
    agentId: string;
    content: string;
    status: 'completed' | 'failed' | 'skipped' | 'rejected';
    error?: string;
}

export interface FlowResult {
    flow: string;
    version: number;
    status: 'completed' | 'failed' | 'rejected';
    steps: Record<string, FlowStepResult>;
    transitions: FlowTransition[];
    compensations: FlowCompensationResult[];
}
