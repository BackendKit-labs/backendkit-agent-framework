// ── Engine ─────────────────────────────────────────────────────────────────────
export { AgentEngine } from './engine/AgentEngine';
export type { AgentEngineOptions } from './engine/AgentEngine';
export type { ToolSearchFn, ToolSearchOptions } from './engine/toolSearch';
export { AgentRegistry } from './engine/AgentRegistry';
export { ToolRegistry } from './engine/ToolRegistry';
export { ProviderRegistry } from './engine/ProviderRegistry';
export { createBaseEngine } from './engine/createBaseEngine';
export type { BaseEngineOptions } from './engine/createBaseEngine';
export { ContextManager, defaultEstimateTokens } from './engine/ContextManager';
export type { ContextOptions, CompactionReport } from './engine/ContextManager';
export { isContextOverflowError } from './engine/contextOverflow';
export { createEngineControl, EngineControlError } from './control/EngineControl';
export type {
    EngineControl, EngineControlAction, EngineControlContext, EngineControlOptions, PolicyControl, PolicyReview,
    WideningRequest, ControlAuditEntry,
} from './control/EngineControl';
export { createJobRegistry, JobLimitError } from './jobs/JobRegistry';
export type { JobRegistry, JobRegistryOptions, JobInfo, JobSpec, JobStatus, JobOutput } from './jobs/JobRegistry';
export { JOB_TOOLS, jobOutputTool, jobListTool, jobKillTool } from './jobs/tools';
export type {
    SandboxMode, SandboxNetwork, SandboxExecRequest, SandboxExecResult, SandboxCaller,
    SandboxDenyCode, SandboxOutcome, SandboxDecision, SandboxRunner, SandboxPathRequest, SandboxPathVerdict,
} from './sandbox/types';
export {
    GuardrailRunner,
    piiGuardrail, secretLeakGuardrail, promptInjectionGuardrail,
    maxLengthGuardrail, denyListGuardrail, llmJudgeGuardrail,
    COMMON_SECRET_PATTERNS, INJECTION_PATTERNS,
} from './guardrails';
export type {
    Guardrail, GuardrailContext, GuardrailDecision, GuardrailOutcome, GuardrailPhase, GuardrailAction,
    GuardrailEventInfo, PiiKind, PiiGuardrailOptions, SecretLeakGuardrailOptions,
    PromptInjectionGuardrailOptions, MaxLengthGuardrailOptions, DenyListGuardrailOptions,
    LlmJudgeGuardrailOptions,
} from './guardrails';
export { IterationManager, DEFAULT_MAX_ITERATIONS, DEFAULT_BATCH_SIZE, GLOBAL_LIMIT } from './engine/IterationManager';
export type { IterationMode, IterationStats, IterationManagerOptions } from './engine/IterationManager';

// ── Delegation ─────────────────────────────────────────────────────────────────
export { DelegationBus } from './delegation/DelegationBus';
export type { DelegationRequest, DelegationResult } from './delegation/DelegationBus';

// ── Memory (session) ───────────────────────────────────────────────────────────
export { SessionMemory } from './memory/SessionMemory';

// ── Transport ──────────────────────────────────────────────────────────────────
export type { Transport, Unsubscribe } from './transport/Transport';
export { StdoutTransport } from './transport/StdoutTransport';
export { CallbackTransport } from './transport/CallbackTransport';

// ── Typed tools ────────────────────────────────────────────────────────────────
export { defineTool, z, zodToParameters, validateToolDefinition, getToolInputSchema, ToolDefinitionError } from './tools/defineTool';
export { ToolError, ToolArgumentError } from './tools/tool-error';
export { createToolContext, createInMemorySessionMemory } from './tools/createToolContext';
export { generateObject, generateObjectWith, StructuredOutputError } from './structured/generateObject';
export type { GenerateObjectOptions, StructuredChat } from './structured/generateObject';
export type { TypedToolOptions, ToolMetadata } from './tools/defineTool';
export type { ToolContextOptions } from './tools/createToolContext';

// ── Skills ─────────────────────────────────────────────────────────────────────
export { SkillRegistry } from './skills/registry';
export { SkillActivator } from './skills/activator';
export type { SkillScope, SkillHandler, SkillExecuteResult, SkillToolDefinition } from './skills/types';

// ── Slash commands ─────────────────────────────────────────────────────────────
export { SlashCommandRegistry } from './commands/SlashCommandRegistry';
export type { SlashCommand, SlashCommandHandler, CommandContext, CommandAgentInfo, CommandSkillInfo } from './commands/SlashCommandRegistry';




// ── Shared utils ───────────────────────────────────────────────────────────────
export { cwdToProjectKey, getFrameworkDir, getProjectDir } from './shared/utils/project-key';
export { atomicWrite, atomicWriteSync } from './shared/utils/atomic-write';
export { ResilientLLMClient } from './shared/llm/resilient-client';
export type { ResilientLLMClientOptions } from './shared/llm/resilient-client';

export { adaptProviderToLLMClient } from './shared/llm/chat-client';
export type { LLMChatClient } from './shared/llm/chat-client';
export { getGitDiff } from './shared/utils/git';
export { sanitizeFilename } from './shared/utils/string-utils';
export { getService, learnedRules, LEARNED_RULES_SERVICE } from './tools/services';
// ── MCP client — MCPClientManager in AgentEngineOptions, MCPServerConfig in coding config ─
export { MCPClientManager, MCP_TOOL_ERROR } from './mcp/MCPClientManager';
export type { MCPServerConfig } from './mcp/types';

// ── Governance contracts (SPEC-0014): principal, policy, approval, audit ─────────
export type {
    Principal, Identity,
    ToolCall, PolicyDecision, ToolPolicy,
    ApproverKind, ApproverRef, ApproverProfile, ApproverDirectory, ApproverAuthority, CredentialRequest, CredentialLease, CredentialBroker, AuditCredential, ApprovalSubject, ApprovalRequest, ApprovalOutcome, Approver,
    ApprovalStatus, StoredApproval, ApprovalStore,
    AuditDecision, AuditOutcome, AuditSandboxDecision, AuditEvent, AuditSink,
} from './governance/types';
export {
    MemoryAuditSink, NdjsonAuditSink, HashChainAuditSink,
    verifyAuditChain, verifyAuditSegment, GENESIS_HASH,
} from './governance/audit';
export type { ChainedAuditEntry, ChainVerification, SegmentVerification } from './governance/audit';
export type { HashChainCheckpointOptions } from './governance/audit';
export { ed25519Signer, signCheckpoint, appendCheckpoint, readCheckpoints, checkpointMessage } from './governance/audit-checkpoint';
export type { AuditCheckpoint, CheckpointSigner } from './governance/audit-checkpoint';
export { exportAuditBundle, verifyAuditBundle, verifyAuditBundleAnchored, BUNDLE_FORMAT } from './governance/audit-bundle';
export { anchorAuditLog, fileAnchor, readAnchors } from './governance/audit-anchor';
export type { AnchorRecord, AnchorVerification, TimestampAnchor } from './governance/audit-anchor';
export type { BundleManifest, BundleVerification } from './governance/audit-bundle';
export { defaultToolPolicy, declaredAskPolicy, combineDecisions, evaluatePolicies, agentCouldPerform } from './governance/policy';
export { approverFromCallback, approvalProblem, approverAuthority } from './governance/approval';
export type { CallbackApprover } from './governance/approval';
export { FileApprovalStore, MemoryApprovalStore } from './governance/approval-store';
export { agentApprover, consoleApprover, describeApproval } from './governance/approvers';
export { DEFAULT_MAX_HOOK_CONTINUES } from './governance/hooks';
export type { EngineHooks, RunContext, ContinueTurn } from './governance/hooks';
export { canonicalJson } from './shared/utils/canonical-json';

// ── MCP tool server — ToolDefinitions served directly over MCP, no model in between
export { createToolServer, createToolServerFactory, createToolRegistrar, hashArgs } from './mcp/tool-server';
export type { ToolServerOptions, ToolCallInfo, ToolCallRecord, ToolCallOutcome } from './mcp/tool-server';
export { startToolServerHttp, isBearerAuthorized, isLoopbackRequest } from './mcp/tool-server-http';
export type { ToolServerHttpOptions, RunningToolServer } from './mcp/tool-server-http';
export { runToolServer, parseToolServerArgs, toolServerUsage } from './mcp/tool-server-cli';
export type { ToolServerCliArgs, ToolServerCliOptions, RunningToolServerCli } from './mcp/tool-server-cli';

// ── Workflow — WorkflowBuilder/Def in AgentEngine.runWorkflow public API ────────
export { workflow, agent, WorkflowBuilder } from './workflow/WorkflowBuilder';
export type { StepOptions } from './workflow/WorkflowBuilder';
export { WorkflowRunner } from './workflow/WorkflowRunner';
export type { WorkflowDef, WorkflowResult, WorkflowRunOptions } from './workflow/types';
export {
    FlowTriggerSchema, FlowGateSchema, FlowStepSchema, FlowCompensationSchema, FlowDefinitionSchema, parseFlow, loadFlow, loadFlowsFromDir, validateFlow, FlowLoadError,
} from './flow';
export type { FlowTrigger, FlowGate, FlowCondition, FlowStep, FlowCompensation, FlowDefinition, FlowTransition, FlowTransitionEvent } from './flow';
export { FlowHost, FlowCancelled, FlowHostError, createFlowHandler, FlowControlError } from './flow';
export { flowFromDefinition, flowRunView } from './flow';
export { flowFromTaskPlan, flowFromStaticFlow } from './flow';
export { createApprovalHandler, summarizeApproval, ApprovalControlError, createFlowTools } from './flow';
export type { ApprovalHandlerPort, ApprovalHandlerOptions, ApprovalSummaryView, ApprovalDecisionInput, FlowToolsOptions } from './flow';
export { planFlow, PLANNER_SYSTEM, UNRESOLVED_AGENT } from './flow';
export type { PlannerAgent, PlanFlowOptions, PlannedFlow } from './flow';
export type { TaskPlanLike, PlanStepLike, StaticFlowLike } from './flow';
export { stepApprovalId } from './flow';
export type { FlowApprovals } from './flow';
export { runFlow, FlowClaimError, KeyedConcurrencyLimiter, interpolate, MemoryRunJournal, NdjsonRunJournal, JournalCorrupt, JournalConflict, foldEvents, journalMatches } from './flow';
export type { NdjsonRunJournalOptions } from './flow';
export type {
    JournalEvent, RunJournal, JournalRun, JournalStep, JournalStepStatus, JournalRunStatus, NewJournalRun, StepPatch, RunPatch,
} from './flow';
export type {
    StepExecutor, StepInput, StepOutput, FlowResult, FlowStepResult, FlowCompensationResult, FlowRunStatus, GateContext, RunFlowOptions, ConcurrencyLimiter, KeyedLimiterOptions,
} from './flow';
export type {
    FlowControl, FlowInfo, FlowRunView, FlowStatus, FlowStepView, InProcessFlow, FlowHandlerPort,
} from './flow';

// ── Triggers — createAutonomousAgent is a standalone public utility ────────────
export { createAutonomousAgent } from './triggers/createAutonomousAgent';
export type { AutonomousAgentOptions, AutonomousAgent } from './triggers/createAutonomousAgent';
export { EventBus } from './triggers/EventBus';
export type { EventPayload } from './triggers/EventBus';
export { TriggerManager } from './triggers/TriggerManager';
export type { TriggerConfig, ScheduleTriggerConfig, WebhookTriggerConfig, EventTriggerConfig } from './triggers/types';

// ── Observability — ObservabilityManager in AgentEngineOptions ─────────────────
export { ObservabilityManager } from './observability/ObservabilityManager';
export { CostTracker } from './observability/CostTracker';
export { MetricsCollector } from './observability/MetricsCollector';
export { Tracer } from './observability/Tracer';
export type { ObservabilityConfig, BudgetUsage, MetricsSnapshot, Span, SpanExporter } from './observability/types';
export { MODEL_PRICING } from './observability/types';

// ── Advanced memory — MemorySystem in AgentEngineOptions, createMemorySystem in coding ─
export { MemorySystem, createMemorySystem } from './agent-memory/MemorySystem';
export { EpisodicMemory } from './agent-memory/EpisodicMemory';
export { SemanticMemory } from './agent-memory/SemanticMemory';
export { ProceduralMemory } from './agent-memory/ProceduralMemory';
export { buildMemoryTools } from './agent-memory/tools';
export { InMemoryStore } from './agent-memory/stores/InMemoryStore';
export { JsonFileStore } from './agent-memory/stores/JsonFileStore';
export type { Episode, Knowledge, Pattern, MemorySystemConfig, MemoryStoreBackend } from './agent-memory/types';

// ── Sources — where an engine gets agents, skills and instructions from (SPEC-0016) ──
export { sanitizeDiskContent, composeInstructionLayers, instructionSourceHooks, listAgentSources, listSkillSources } from './sources';
export type { AgentSource, SkillSource, InstructionSource, InstructionLayer } from './sources';

// ── Reflection — failure catalog, pattern detection, policy promotion (verticals add their own domains) ──
export * from './reflection';


// ── Core types ─────────────────────────────────────────────────────────────────
export type {
    AgentProfile,
    SecretRef,
    ToolDefinition,
    ExecutionContext,
    SessionMemoryData,
    ModelConfig,
    LLMMessage,
    LLMToolCall,
    LLMStreamCallbacks,
    LLMProvider,
    ChatOptions,
    StructuredOutputSupport,
    AgentEvent,
    RunResult,
    RunToolCall,
    EngineOptions,
    JSONSchema,
    ToolApprovalDecision,
    Skill,
} from './types';

// ── Learning from experience: lessons and proposed rules (SPEC-0017 F6) ─────────
export { createLearning, ENGINE_HINTS, FileLessonStore, FileRuleStore, MemoryLessonStore, MemoryRuleStore } from './learning';
export type {
    AddRuleInput, ApprovedRule, Experience, ExperienceInput, LearnedPattern, Learning, PatternRecord, LearnedRulesView, LearningOptions, LessonStore, LessonUnitInfo, OutcomeInput, RuleStore, Severity,
    TaughtLesson, TeachInput, ToolRule,
} from './learning';
