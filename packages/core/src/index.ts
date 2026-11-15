// ── Engine ─────────────────────────────────────────────────────────────────────
export { AgentEngine } from './engine/AgentEngine';
export type { AgentEngineOptions } from './engine/AgentEngine';
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
export { createToolContext, createInMemorySessionMemory } from './tools/createToolContext';
export { generateObject, generateObjectWith, StructuredOutputError } from './structured/generateObject';
export type { GenerateObjectOptions, StructuredChat } from './structured/generateObject';
export type { TypedToolOptions, ToolMetadata } from './tools/defineTool';
export type { ToolContextOptions } from './tools/createToolContext';

// ── Skills ─────────────────────────────────────────────────────────────────────
export { SkillLoader } from './skills/loader';
export { SkillManager, createSkillManager } from './skills/manager';
export type { InstallOptions, InstalledPack } from './skills/manager';
export { SkillRegistry } from './skills/registry';
export { SkillActivator } from './skills/activator';
export { parseMdSkill, skillToMd } from './skills/parse-md-skill';
export { GitHubProvider, LocalProvider, SkillsShProvider, ObsidianProvider } from './skills/providers';
export type { SkillSourceProvider, FetchOptions } from './skills/providers';
export type { LoadedSkills } from './skills/loader';

// ── Slash commands ─────────────────────────────────────────────────────────────
export { SlashCommandRegistry } from './commands/SlashCommandRegistry';
export type { SlashCommand, SlashCommandHandler, CommandContext, CommandAgentInfo, CommandSkillInfo } from './commands/SlashCommandRegistry';
export { registerBuiltinCommands } from './commands/builtin';

// ── Checkpoint ─────────────────────────────────────────────────────────────────
export {
    createCheckpoint, listCheckpoints, readCheckpoint,
    getLatestCheckpoints, extractSessionFromCheckpoint,
    compactSession, compactSessionContent,
} from './checkpoint';
export type { CheckpointSummary } from './checkpoint';

// ── Workspace ──────────────────────────────────────────────────────────────────
export {
    loadWorkspaces, saveWorkspaces, createWorkspace, addProject, importProject,
    removeProject, deleteWorkspace, setActiveProject, buildWorkspaceContext,
    deriveProjectName, migrateFromLegacy, setCommonRoot, detectCommonRoot,
} from './workspace';
export type { WorkspaceProject, WorkspaceEntry, WorkspacesConfig } from './workspace';

// ── Bootstrap ──────────────────────────────────────────────────────────────────
export { runGlobalSeed } from './bootstrap/GlobalSeed';
export type { SeedResult } from './bootstrap/GlobalSeed';
export { loadFrameworkConfig, DEFAULT_CONFIG } from './bootstrap/config';
export type { FrameworkConfig, ProviderConfig, FrameworkFeatures } from './bootstrap/config';

// ── Shared utils ───────────────────────────────────────────────────────────────
export { cwdToProjectKey, getFrameworkDir, getProjectDir } from './shared/utils/project-key';
export { atomicWrite, atomicWriteSync } from './shared/utils/atomic-write';
export {
    TRUST_FILE, trustFilePath, canonicalProjectPath, listTrustedProjects, isProjectTrusted, trustProject,
    untrustProject, projectLayerContents, untrustedLayerWarning,
} from './trust/workspace-trust';
export type { TrustStatus, TrustReason, ProjectLayerContents } from './trust/workspace-trust';
export { ResilientLLMClient } from './shared/llm/resilient-client';
export type { ResilientLLMClientOptions } from './shared/llm/resilient-client';

// ── Orchestration — public surface used by createBaseEngine / createCodingEngine ─
export { Orchestrator } from './orchestration/orchestrator';
export { adaptProviderToLLMClient } from './orchestration/llm-client-adapter';
export type { LLMChatClient } from './orchestration/intent-detector';
export type { ReviewAgentIds } from './orchestration/orchestrator';
export type {
    OrchestratorConfig,
    OrchestrationResult,
    AgentPipelinePhase,
    PolicyRule,
    CapabilityMatrix,
} from './orchestration/types';

// ── MCP client — MCPClientManager in AgentEngineOptions, MCPServerConfig in coding config ─
export { MCPClientManager } from './mcp/MCPClientManager';
export type { MCPServerConfig } from './mcp/types';

// ── Governance contracts (SPEC-0014): principal, policy, approval, audit ─────────
export type {
    Principal, Identity,
    ToolCall, PolicyDecision, ToolPolicy,
    ApproverKind, ApproverRef, ApprovalSubject, ApprovalRequest, ApprovalOutcome, Approver,
    ApprovalStatus, StoredApproval, ApprovalStore,
    AuditDecision, AuditOutcome, AuditSandboxDecision, AuditEvent, AuditSink,
} from './governance/types';
export {
    MemoryAuditSink, NdjsonAuditSink, HashChainAuditSink,
    verifyAuditChain, verifyAuditSegment, GENESIS_HASH,
} from './governance/audit';
export type { ChainedAuditEntry, ChainVerification, SegmentVerification } from './governance/audit';
export { defaultToolPolicy, combineDecisions, evaluatePolicies } from './governance/policy';
export { approverFromCallback, approvalProblem } from './governance/approval';
export type { CallbackApprover } from './governance/approval';
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

// ── Agent discovery — loadAgents callback in AgentEngineOptions ────────────────
export { discoverAgents } from './agent-discovery/discoverAgents';
export { RemoteAgentRegistry } from './agent-discovery/RemoteAgentRegistry';
export { loadAgentsFromDir, globalAgentsDir, projectAgentsDir } from './agent-discovery/AgentPackageLoader';
export type { AgentPackageFile, AgentDiscoveryConfig, RemoteRegistryIndex } from './agent-discovery/types';

// ── Reflection — ReflectionEngine used by createCodingEngine ──────────────────
export { ReflectionEngine } from './reflection/reflection-engine';
export type { ReflectionStats } from './reflection/reflection-engine';
export { DomainRegistry, BUILTIN_DOMAINS } from './reflection/domain-registry';
export type { BuiltinDomain, CustomDomainDefinition, FailureTypeDefinition } from './reflection/domain-registry';

// ── QA — QAService used by createBaseEngine ────────────────────────────────────
export { QAService } from './qa/qa-service';
export type { QAServiceOptions, QAReviewResult } from './qa/qa-service';

// ── Core types ─────────────────────────────────────────────────────────────────
export type {
    AgentProfile,
    SecretRef,
    ToolDefinition,
    ExecutionContext,
    SessionMemoryData,
    ProjectStoreData,
    SessionUpdates,
    ModelConfig,
    LLMMessage,
    LLMToolCall,
    LLMStreamCallbacks,
    LLMProvider,
    ChatOptions,
    StructuredOutputSupport,
    AgentEvent,
    EngineOptions,
    JSONSchema,
    ToolApprovalDecision,
    Skill,
} from './types';
