export interface SkillToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    /** Handler name to look up in SkillRegistry */
    handler: string;
}

/** Where a skill lives in the 3-layer hierarchy */
export type SkillScope = 'global' | 'pack' | 'project';

export interface Skill {
    name: string;
    version: string;
    description: string;
    /** Keywords that activate this skill when matched in user input */
    triggers: string[];
    /** Agent IDs that always have this skill active regardless of input */
    agents?: string[];
    /** Markdown injected into the system prompt when the skill is active */
    systemPromptAddition?: string;
    tools?: SkillToolDefinition[];
    customInstructions?: string;
    /**
     * Languages/stacks this skill applies to.
     * undefined or empty = language-agnostic (always available).
     * Examples: ['node', 'typescript'], ['python'], ['java']
     */
    language?: string[];
    /** Determined by where the skill was loaded from */
    scope?: SkillScope;
    /** Source pack name, e.g. '@bk-node', '@vercel' */
    pack?: string;
}

export type SkillHandler = (args: unknown) => Promise<string>;

/**
 * Security configuration for SkillManager.
 * Controls which sources are trusted and how much content a skill can inject.
 */
export interface TrustConfig {
    /**
     * Source prefix allowlist. Only sources that start with one of these strings
     * can be installed. Leave undefined to allow any source (open mode).
     *
     * Examples:
     *   ['https://github.com/my-org/', 'https://skills.sh/', './local-skills']
     */
    allowedSources?: string[];

    /**
     * Max bytes allowed for a skill's systemPromptAddition.
     * Prevents prompt-flooding even from trusted sources.
     * Default: 20_000 bytes (~20 KB).
     */
    maxPromptBytes?: number;
}

export interface SkillExecuteResult {
    ok: boolean;
    data?: string;
    error?: string;
}

/** Metadata written to sources.json when a pack is installed */
export interface SkillPackSource {
    pack: string;
    source: string;       // URL or npm package name
    installedAt: string;  // ISO date
    version?: string;
}
