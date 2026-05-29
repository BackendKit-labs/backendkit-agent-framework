// ── Skill infrastructure (generic, domain-agnostic) ──────────────────────────
// Builtin skill content (GLOBAL_BUILTIN_SKILLS, NODE_PACK_SKILLS, etc.) has moved
// to @bk/agent-coding — it belongs to the coding agent domain, not the generic core.
export { SkillLoader } from './loader';
export { SkillManager } from './manager';
export type { InstallOptions, InstalledPack } from './manager';
export { SkillRegistry } from './registry';
export { SkillActivator } from './activator';
export type {
    Skill,
    SkillScope,
    SkillHandler,
    SkillExecuteResult,
    SkillToolDefinition,
    SkillPackSource,
} from './types';
export type { LoadedSkills } from './loader';
