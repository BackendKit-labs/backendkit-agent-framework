// The coding pipeline: task classification (intent, domains, risk, policies, FSM), QA gates and the engine
// hooks that apply them (SPEC-0015). Import from '@backendkit-labs/agent-coding/pipeline'.

// Engine hooks
export { codingPipelineHooks, buildOrchestrationBrief } from './coding-pipeline-hooks';
export type { CodingPipelineHooksOptions } from './coding-pipeline-hooks';

// Orchestrator, FSM, audit
export * from './orchestration';

// Learning: the audit findings as experiences, and the orchestrator rules a person approves (SPEC-0017 F6)
export { createCodingLearning, policyRuleFor, recordAuditFindings, approvedPolicyRules } from './learning';
export type { CodingLearningOptions, CodingPolicyProposal } from './learning';

// QA
export { QAService } from './qa/qa-service';
export type { QAServiceOptions, QAReviewResult } from './qa/qa-service';

// Learning hooks tied to the pipeline's audit trail
export { AuditHook } from './reflection/hooks/audit-hook';
export { AgentHook } from './reflection/hooks/agent-hook';
export { TestHook } from './reflection/hooks/test-hook';
export { CommitHook } from './reflection/hooks/commit-hook';
export { BootstrapHook } from './reflection/hooks/bootstrap-hook';
export { HistoricalLoader } from './reflection/historical-loader';
export { LessonsMemoGenerator } from './reflection/lessons-memo-generator';
