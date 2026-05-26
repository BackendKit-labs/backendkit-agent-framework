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
