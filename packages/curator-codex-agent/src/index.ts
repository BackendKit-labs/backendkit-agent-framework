export type {
    CodeAnalysisNote,
    CodeAnalysisResponse,
    CodeAnalysisResult,
    AssociatedDocs,
    FileAnalysisContext,
} from './types.js';

export { resolveProject, findNote } from './project.js';
export type { ProjectContext } from './project.js';

export { CodeAnalyzer } from './analyzer.js';
export type { CodeAnalyzerOptions } from './analyzer.js';

export { DocumentationCurator } from './documentation-curator.js';
export type { DocumentationCuratorOptions } from './documentation-curator.js';

export { extractPdfText } from './pdf-reader.js';
export type { PdfContent } from './pdf-reader.js';

export {
    normalizeSourcePath,
    readSourcePath,
    removeNotesForSource,
    findOrphanedNotes,
    deleteNotes,
} from './vault-dedup.js';
export type { OrphanedNote } from './vault-dedup.js';

export {
    calculateFileHash,
    loadManifest,
    saveManifest,
    hasFileChanged,
    createManifest,
    updateManifestEntry,
    isCodeFile,
    isDocFile,
    findAllFiles,
} from './checksum.js';
export type { CodexManifest, FileChecksum } from './checksum.js';

export { CodexAuditLogger, buildCodexAuditPath } from './audit.js';
export type { CodexEvent, CodexAuditEntry } from './audit.js';

export { createProvider, OpenAIAdapter, AnthropicAdapter } from './providers/index.js';
export type { CuratorLLMProvider, ProviderConfig, ProviderName } from './providers/index.js';

export { KnowledgeEngine } from './knowledge/engine.js';
export type { SearchResponse, ReloadResponse } from './knowledge/engine.js';

export { CuratorRagProvider } from './knowledge/rag-provider.js';
export type { RagSearchResult, RagSearchOptions } from './knowledge/rag-provider.js';

export { KnowledgeSynthesizer } from './knowledge/synthesis.js';
export type { SynthesizedNote } from './knowledge/synthesis.js';

export { TransformersEmbedder } from './knowledge/transformers-embedder.js';
export type { EmbedderProgress } from './knowledge/transformers-embedder.js';
