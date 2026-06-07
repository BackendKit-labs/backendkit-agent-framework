// ── Engine ─────────────────────────────────────────────────────────────────────
export { AgentEngine } from './engine/AgentEngine';
export type { AgentEngineOptions } from './engine/AgentEngine';
export { AgentRegistry } from './engine/AgentRegistry';
export { ToolRegistry } from './engine/ToolRegistry';
export { ProviderRegistry } from './engine/ProviderRegistry';
export { createBaseEngine } from './engine/createBaseEngine';
export type { BaseEngineOptions } from './engine/createBaseEngine';
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
export { defineTool, z } from './tools/defineTool';
export type { TypedToolOptions } from './tools/defineTool';

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
export { ResilientLLMClient } from './shared/llm/resilient-client';
export type { ResilientLLMClientOptions } from './shared/llm/resilient-client';

// ── Orchestration — public surface used by createBaseEngine / createCodingEngine ─
export { Orchestrator } from './orchestration/orchestrator';
export { adaptProviderToLLMClient } from './orchestration/llm-client-adapter';
export type { LLMChatClient } from './orchestration/intent-detector';
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
export type { ObservabilityConfig, MetricsSnapshot, Span, SpanExporter } from './observability/types';
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
    AgentEvent,
    EngineOptions,
    JSONSchema,
    ToolApprovalDecision,
    Skill,
} from './types';
