// ── Skill contracts (generic, domain-agnostic) ───────────────────────────────
// Reading skills from disk, GitHub or skills.sh, and installing them, live in
// @backendkit-labs/agent-coding/cli (SPEC-0016). Builtin skill content lives in agent-coding too.
export { SkillRegistry } from './registry';
export { SkillActivator } from './activator';
export type {
    Skill,
    SkillScope,
    SkillHandler,
    SkillExecuteResult,
    SkillToolDefinition,
} from './types';
