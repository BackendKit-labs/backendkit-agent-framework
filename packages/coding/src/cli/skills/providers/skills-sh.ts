import { GitHubProvider } from './github';
import type { FetchOptions, SkillSourceProvider } from './types';
import type { Skill } from '@backendkit-labs/agent-core';

/**
 * Fetches skills from the skills.sh registry.
 *
 * skills.sh is a discovery directory — actual skill files live on GitHub.
 * This provider resolves a skills.sh URL to its underlying GitHub repo
 * and delegates fetching to GitHubProvider.
 *
 * Accepted source formats:
 *   https://skills.sh/{owner}/{repo}              — fetch all skills from the repo
 *   https://www.skills.sh/{owner}/{repo}          — same (www prefix)
 *   https://skills.sh/{owner}/{repo}/{skill-name} — fetch a specific skill
 *
 * Example:
 *   https://skills.sh/vercel-labs/skills
 *   → resolves to https://github.com/vercel-labs/skills
 *   → GitHubProvider fetches skill files from the /skills folder or root
 */
export class SkillsShProvider implements SkillSourceProvider {
    readonly id = 'skills-sh';

    private readonly github: GitHubProvider;

    constructor(appName = 'agent') {
        this.github = new GitHubProvider(appName);
    }

    canHandle(source: string): boolean {
        return /^https?:\/\/(www\.)?skills\.sh\//i.test(source);
    }

    async fetch(source: string, options?: FetchOptions): Promise<Skill[]> {
        const { githubUrl, skillName } = this.resolveToGitHub(source);
        return this.github.fetch(githubUrl, {
            skill: options?.skill ?? skillName,
        });
    }

    /**
     * Maps https://skills.sh/{owner}/{repo}/{skill?}
     * to   https://github.com/{owner}/{repo}
     */
    private resolveToGitHub(source: string): { githubUrl: string; skillName?: string } {
        const match = source.match(/skills\.sh\/([^/?#]+)\/([^/?#]+)(?:\/([^/?#]+))?/i);
        if (!match) throw new Error(`Cannot parse skills.sh URL: ${source}`);
        const [, owner, repo, skillName] = match;
        return {
            githubUrl: `https://github.com/${owner}/${repo}`,
            skillName: skillName || undefined,
        };
    }
}
