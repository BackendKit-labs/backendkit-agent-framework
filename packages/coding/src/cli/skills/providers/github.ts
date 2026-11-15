import { fromThrowable, isOk } from '@backendkit-labs/result';
import { parseMdSkill } from '../parse-md-skill';
import type { Skill } from '@backendkit-labs/agent-core';
import type { FetchOptions, SkillSourceProvider } from './types';
import * as yaml from 'yaml';

interface RemoteFile {
    name: string;
    download_url: string;
}

const SKILL_FILE_RE = /\.(ya?ml|md)$/i;

/**
 * Fetches skill packs from GitHub repositories.
 * Looks for skill files in a /skills subfolder first, then the repo root.
 * Supports both .yaml/.yml and .md (with frontmatter) skill files.
 *
 * Accepted source formats:
 *   https://github.com/{owner}/{repo}
 *   https://github.com/{owner}/{repo}.git
 */
export class GitHubProvider implements SkillSourceProvider {
    readonly id = 'github';

    constructor(private readonly appName: string = 'agent') {}

    canHandle(source: string): boolean {
        return /^https?:\/\/github\.com\//i.test(source);
    }

    async fetch(source: string, options?: FetchOptions): Promise<Skill[]> {
        const match = source.match(/github\.com\/([^/]+)\/([^/?#]+)/i);
        if (!match) throw new Error(`Invalid GitHub URL: ${source}`);
        const [, owner, repo] = match;
        const cleanRepo = repo.replace(/\.git$/, '');

        for (const folder of ['skills', '']) {
            const apiUrl = `https://api.github.com/repos/${owner}/${cleanRepo}/contents/${folder}`;
            const files = await this.listSkillFiles(apiUrl);
            if (files.length > 0) {
                return this.downloadAndParse(files, options?.skill);
            }
        }
        return [];
    }

    private async listSkillFiles(apiUrl: string): Promise<RemoteFile[]> {
        let res: Response;
        try {
            res = await fetch(apiUrl, {
                headers: {
                    Accept: 'application/vnd.github.v3+json',
                    'User-Agent': this.appName,
                },
            });
        } catch (e) {
            throw new Error(`Network error reaching GitHub API: ${String(e)}`);
        }

        if (res.status === 404) return [];
        if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${apiUrl}`);

        const data = fromThrowable(() => res.json() as Promise<unknown>);
        if (!isOk(data)) return [];

        const items = await data.value;
        if (!Array.isArray(items)) return [];

        return (items as Array<Record<string, unknown>>)
            .filter(f => f['type'] === 'file' && typeof f['name'] === 'string' && SKILL_FILE_RE.test(f['name'] as string))
            .map(f => ({ name: f['name'] as string, download_url: f['download_url'] as string }));
    }

    private async downloadAndParse(files: RemoteFile[], onlySkill?: string): Promise<Skill[]> {
        const results = await Promise.allSettled(
            files.map(async file => {
                let res: Response;
                try {
                    res = await fetch(file.download_url);
                } catch (e) {
                    throw new Error(`Network error fetching ${file.name}: ${String(e)}`);
                }
                if (!res.ok) throw new Error(`Failed to download ${file.name}: HTTP ${res.status}`);

                const text = await res.text();
                const skill = /\.md$/i.test(file.name)
                    ? parseMdSkill(text)
                    : parseYamlSkill(text);

                if (!skill) throw new Error(`Invalid skill file: ${file.name}`);
                if (onlySkill && skill.name !== onlySkill) return null;
                return skill;
            }),
        );

        const skills: Skill[] = [];
        const errors: string[] = [];

        for (const r of results) {
            if (r.status === 'rejected') errors.push(String(r.reason));
            else if (r.value != null) skills.push(r.value);
        }

        if (errors.length > 0 && skills.length === 0) {
            throw new Error(`All skill downloads failed:\n${errors.join('\n')}`);
        }

        return skills;
    }
}

function parseYamlSkill(text: string): Skill | null {
    const parsed = fromThrowable(() => yaml.parse(text) as Skill);
    if (!parsed.ok || !parsed.value?.name) return null;
    const skill = parsed.value;
    if (!Array.isArray(skill.triggers)) skill.triggers = [];
    return skill;
}
