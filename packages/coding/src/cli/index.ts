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

// Skills: read from disk, GitHub or skills.sh, and install them.
export { SkillLoader } from './skills/loader';
export type { LoadedSkills } from './skills/loader';
export { SkillManager, createSkillManager } from './skills/manager';
export type { InstallOptions, InstalledPack } from './skills/manager';
export { parseMdSkill, skillToMd } from './skills/parse-md-skill';
export { GitHubProvider, LocalProvider, SkillsShProvider, ObsidianProvider } from './skills/providers';
export type { SkillSourceProvider, FetchOptions } from './skills/providers';
export { detectStack } from './skills/stack';

// The terminal app: built-in slash commands, workspaces, checkpoints, trust and first-run seed.
export { registerBuiltinCommands } from './commands/builtin';
export * from './checkpoint';
export * from './workspace';
export * from './bootstrap/GlobalSeed';
export * from './bootstrap/config';
export * from './trust/workspace-trust';
export type { SkillPackSource, TrustConfig } from './skills/types';
