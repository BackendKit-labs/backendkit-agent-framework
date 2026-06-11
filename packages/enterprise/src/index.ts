export { ObsidianRAGProvider } from './rag/ObsidianRAGProvider';
export type { ObsidianRAGOptions, Embedder } from './rag/ObsidianRAGProvider';

export { OllamaEmbedder, OLLAMA_EMBED_DEFAULT_HOST, OLLAMA_EMBED_DEFAULT_MODEL } from './rag/OllamaEmbedder';
export type { OllamaEmbedderOptions } from './rag/OllamaEmbedder';

export { VectorStore } from './rag/VectorStore';
export type { VectorChunk, SearchResult } from './rag/VectorStore';

export { VaultIndexer } from './rag/VaultIndexer';
export type { IndexerOptions, RawChunk } from './rag/VaultIndexer';

export { VaultWriter } from './rag/VaultWriter';
export type { VaultWriterOptions, WriteNoteParams } from './rag/VaultWriter';

export { SimpleEmbedder } from './rag/SimpleEmbedder';

// ── Enterprise profiles ───────────────────────────────────────────────────────

export {
    GENERAL_PROFILE,
    SUPPORT_PROFILE,
    HR_PROFILE,
    SALES_PROFILE,
    FINANCE_PROFILE,
    OPS_PROFILE,
    ALL_ENTERPRISE_PROFILES,
    ENTERPRISE_TOOLS,
    VAULT_FOLDERS,
} from './profiles';

// ── Declarative flows ─────────────────────────────────────────────────────────

export {
    FlowTriggerSchema,
    FlowGateSchema,
    FlowStepSchema,
    FlowCompensationSchema,
    FlowDefinitionSchema,
    parseFlow,
    loadFlow,
    loadFlowsFromDir,
    FlowLoadError,
    FlowRunner,
    interpolate,
    ComplianceGate,
    ComplianceGateError,
} from './flow';
export type {
    FlowTrigger,
    FlowGate,
    FlowStep,
    FlowCompensation,
    FlowDefinition,
    FlowTransition,
    FlowTransitionEvent,
    FlowStepResult,
    FlowCompensationResult,
    FlowResult,
    FlowRunOptions,
    FlowAgentRunner,
    GateCriterion,
    GateLogEvent,
    GateLogEntry,
    GateRecord,
    ComplianceGateOptions,
} from './flow';

// ── Events (broker + reconciliation) ─────────────────────────────────────────

export { EventPublisher, ReconciliationSweeper } from './events';
export type {
    QueueLike,
    EventPublisherOptions,
    ReconciliationSweeperOptions,
    EventEnvelope,
    EventSchema,
    PublishOptions,
    OrphanedEvent,
    ReconciliationReport,
} from './events';

// ── Factory ───────────────────────────────────────────────────────────────────

export { createEnterpriseSetup } from './factory';
export type { EnterpriseSetupOptions, EnterpriseSetup } from './factory';
