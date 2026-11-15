/**
 * `@backendkit-labs/agent-coding/cli` — the file-based adapters and the pieces of a terminal app that used to
 * live in agent-core (SPEC-0016). Nothing here is needed by an engine that gets its agents, skills and
 * instructions from other sources.
 */
export * from './agent-discovery';
export { runContextPipeline, formatPipelineForPrompt, StageCache } from './context';
export type { PipelineResult, PipelineConfig, PipelineChecksums, InstructionsResult, ProjectResult, SessionResult, ManifestResult, LessonsResult } from './context';
export { fileAgentSource, fileInstructionSource } from './file-sources';
export type { FileInstructionSourceOptions } from './file-sources';
