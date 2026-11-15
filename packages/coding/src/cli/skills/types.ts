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

/** Metadata written to sources.json when a pack is installed */
export interface SkillPackSource {
    pack: string;
    source: string;       // URL or npm package name
    installedAt: string;  // ISO date
    version?: string;
}
