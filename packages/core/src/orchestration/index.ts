// Main orchestrator
export { Orchestrator } from './orchestrator';
export type { ReviewAgentIds } from './orchestrator';
export type { LLMChatClient } from './intent-detector';

// Pipeline components
export { detectIntent, enrichTaskWithIntent } from './intent-detector';
export { detectDomains, enrichTaskWithDomains } from './domain-detector';
export { calculateRisk, enrichTaskWithRisk } from './risk-scorer';
export { evaluatePolicies, applyPolicies } from './policy-engine';
export { TaskFSM } from './fsm';

// Audit
export { AuditReporter } from './audit-reporter';

// Types
export type {
    OrchestratorConfig,
    OrchestrationResult,
    AgentCapability,
    CapabilityMatrix,
    AgentPipelinePhase,
    AgentPipelinePhaseType,
} from './types';
export { defaultOrchestratorConfig } from './types';

export type {
    TaskContext,
    ActionType,
    RiskLevel,
    RiskFactors,
    TaskStatus,
    CommitPlan,
    ConventionalCommitType,
    DelegationRequest,
    DelegationResult,
} from './task-context';
export {
    createTaskContext,
    touchTask,
    transitionTask,
    detectScopeFromFiles,
} from './task-context';

export type { FSMTransitionResult } from './fsm';
export type { GateVeredict } from './audit';
