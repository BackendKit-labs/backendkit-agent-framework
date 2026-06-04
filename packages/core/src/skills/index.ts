// ── Skill infrastructure (generic, domain-agnostic) ──────────────────────────
// Builtin skill content (GLOBAL_BUILTIN_SKILLS, NODE_PACK_SKILLS, etc.) has moved
// to @backendkit-labs/agent-coding — it belongs to the coding agent domain, not the generic core.
export { SkillLoader } from './loader';
export { SkillManager, createSkillManager } from './manager';
export type { InstallOptions, InstalledPack } from './manager';
export { SkillRegistry } from './registry';
export { SkillActivator } from './activator';
export { parseMdSkill, skillToMd } from './parse-md-skill';
export { GitHubProvider, LocalProvider, SkillsShProvider, ObsidianProvider } from './providers';
export type { SkillSourceProvider, FetchOptions } from './providers';
export type {
    Skill,
    SkillScope,
    SkillHandler,
    SkillExecuteResult,
    SkillToolDefinition,
    SkillPackSource,
    TrustConfig,
} from './types';
export type { LoadedSkills } from './loader';
