/**
 * The flow definition lives in `agent-core` since SPEC-0023 F1 (`@backendkit-labs/agent-core`). It is re-exported here so that
 * nothing that imports it from `agent-enterprise` changes. What stays is the result of the runner of this package.
 */
export {
    FlowTriggerSchema, FlowGateSchema, FlowStepSchema, FlowCompensationSchema, FlowDefinitionSchema,
} from '@backendkit-labs/agent-core';
export type {
    FlowTrigger, FlowGate, FlowStep, FlowCompensation, FlowDefinition, FlowTransition, FlowTransitionEvent,
} from '@backendkit-labs/agent-core';
import type { FlowTransition } from '@backendkit-labs/agent-core';

// ── Execution types ───────────────────────────────────────────────────────────

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
