import type { Skill } from '../types';

export interface FetchOptions {
    /** Only fetch this specific skill by name */
    skill?: string;
}

/**
 * A pluggable source for skill packs.
 * Implement this interface to add support for new registries (skills.sh, npm, etc.)
 * or custom storage (Obsidian vaults, internal wikis, etc.).
 *
 * Registration:
 *   manager.use(new MyProvider())
 *
 * Providers are tried in registration order (last registered = highest priority).
 * The first provider whose canHandle() returns true is used.
 */
export interface SkillSourceProvider {
    /** Unique identifier, e.g. 'github', 'local', 'skills-sh', 'obsidian' */
    readonly id: string;
    /** Returns true if this provider knows how to fetch from the given source string */
    canHandle(source: string): boolean;
    /** Fetches skills from the source and returns them normalized as Skill[] */
    fetch(source: string, options?: FetchOptions): Promise<Skill[]>;
}
