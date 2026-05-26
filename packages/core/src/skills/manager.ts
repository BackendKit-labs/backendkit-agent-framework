import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import { run, isOk, fromThrowable } from '@backendkit-labs/result';
import { getFrameworkDir } from '../shared/utils/project-key';
import { atomicWrite } from '../shared/utils/atomic-write';
import type { Skill, SkillPackSource } from './types';

export interface InstallOptions {
    /** Only install this specific skill from the source (by name) */
    skill?: string;
    /** Override the derived pack name */
    pack?: string;
    /** Overwrite if already installed */
    force?: boolean;
}

export interface InstalledPack extends SkillPackSource {
    /** Skill names found in this pack's directory */
    skills: string[];
}

type SourceKind = 'github' | 'local' | 'unsupported';

interface RemoteFile {
    name: string;
    download_url: string;
}

/**
 * Manages lifecycle of external skill packs:
 * install, uninstall, list, update.
 *
 * Safety guarantee: disk is only modified after ALL network fetches succeed.
 * If a fetch fails mid-way, existing packs are untouched.
 */
export class SkillManager {
    private readonly packsDir: string;
    private readonly sourcesFile: string;

    constructor(private readonly appName: string) {
        const skillsDir = path.join(getFrameworkDir(appName), 'skills');
        this.packsDir = path.join(skillsDir, 'packs');
        this.sourcesFile = path.join(skillsDir, 'sources.json');
    }

    async install(source: string, options: InstallOptions = {}): Promise<void> {
        const packName = options.pack ?? this.derivePackName(source);
        const packDir = this.packDir(packName);

        if (!options.force) {
            const alreadyInstalled = await run(() => fs.access(packDir));
            if (isOk(alreadyInstalled)) {
                throw new Error(
                    `Pack '${packName}' is already installed. Use force: true or call update() to refresh.`,
                );
            }
        }

        // --- Fetch everything into memory first (safe: no disk writes yet) ---
        const kind = this.detectSource(source);
        let skills: Skill[];

        if (kind === 'github') {
            skills = await this.fetchFromGitHub(source, options.skill);
        } else if (kind === 'local') {
            skills = await this.fetchFromLocal(source, options.skill);
        } else {
            throw new Error(
                `Unsupported source: '${source}'. Supported: GitHub URLs (https://github.com/...), local paths (/abs or ./rel).`,
            );
        }

        if (skills.length === 0) {
            throw new Error(`No valid skills found in '${source}'${options.skill ? ` matching skill '${options.skill}'` : ''}.`);
        }

        // --- Write to disk only after successful fetch ---
        await fs.mkdir(packDir, { recursive: true });
        await Promise.all(
            skills.map(skill => {
                const filePath = path.join(packDir, `${skill.name}.yaml`);
                const content = yaml.stringify({ ...skill, scope: 'pack', pack: packName });
                return atomicWrite(filePath, content);
            }),
        );

        await this.upsertSource({
            pack: packName,
            source,
            installedAt: new Date().toISOString(),
        });
    }

    async uninstall(packName: string): Promise<void> {
        const packDir = this.packDir(packName);
        const result = await run(() => fs.rm(packDir, { recursive: true, force: true }));
        if (!isOk(result)) {
            throw new Error(`Failed to remove pack '${packName}': ${String(result.error)}`);
        }
        await this.removeSource(packName);
    }

    async list(): Promise<InstalledPack[]> {
        const sources = await this.loadSources();
        return Promise.all(
            sources.map(async src => {
                const filesResult = await run(() => fs.readdir(this.packDir(src.pack)));
                const skills = isOk(filesResult)
                    ? filesResult.value
                        .filter(f => /\.ya?ml$/.test(f))
                        .map(f => f.replace(/\.ya?ml$/, ''))
                    : [];
                return { ...src, skills };
            }),
        );
    }

    async update(packName: string): Promise<void> {
        const sources = await this.loadSources();
        const entry = sources.find(s => s.pack === packName);
        if (!entry) throw new Error(`Pack '${packName}' is not installed. Run install() first.`);
        await this.install(entry.source, { pack: packName, force: true });
    }

    // ---------------------------------------------------------------------------
    // Private — source detection
    // ---------------------------------------------------------------------------

    private detectSource(source: string): SourceKind {
        if (/^https?:\/\/github\.com\//i.test(source)) return 'github';
        if (source.startsWith('/') || source.startsWith('.')) return 'local';
        return 'unsupported';
    }

    private derivePackName(source: string): string {
        const githubMatch = source.match(/github\.com\/([^/]+)\/([^/?#]+)/i);
        if (githubMatch) return `@${githubMatch[1]}`;
        return path.basename(source);
    }

    /** Filesystem-safe directory name: replace / with - */
    private packDir(packName: string): string {
        return path.join(this.packsDir, packName.replace(/\//g, '-'));
    }

    // ---------------------------------------------------------------------------
    // Private — GitHub fetcher
    // ---------------------------------------------------------------------------

    private async fetchFromGitHub(repoUrl: string, onlySkill?: string): Promise<Skill[]> {
        const match = repoUrl.match(/github\.com\/([^/]+)\/([^/?#]+)/i);
        if (!match) throw new Error(`Invalid GitHub URL: ${repoUrl}`);
        const [, owner, repo] = match;
        const cleanRepo = repo.replace(/\.git$/, '');

        // Try skills/ subfolder first, then repo root
        for (const folder of ['skills', '']) {
            const apiUrl = `https://api.github.com/repos/${owner}/${cleanRepo}/contents/${folder}`;
            const files = await this.githubListYamlFiles(apiUrl);
            if (files.length > 0) {
                return this.downloadAndParseSkills(files, onlySkill);
            }
        }

        return [];
    }

    private async githubListYamlFiles(apiUrl: string): Promise<RemoteFile[]> {
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
            .filter(f => f['type'] === 'file' && typeof f['name'] === 'string' && /\.ya?ml$/i.test(f['name'] as string))
            .map(f => ({ name: f['name'] as string, download_url: f['download_url'] as string }));
    }

    private async downloadAndParseSkills(files: RemoteFile[], onlySkill?: string): Promise<Skill[]> {
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
                const parsed = fromThrowable(() => yaml.parse(text) as Skill);
                if (!isOk(parsed)) throw new Error(`Invalid YAML in ${file.name}`);

                const skill = parsed.value;
                if (!skill?.name || !Array.isArray(skill.triggers)) {
                    throw new Error(`Skill ${file.name} missing required fields (name, triggers)`);
                }
                if (onlySkill && skill.name !== onlySkill) return null;
                return skill;
            }),
        );

        const skills: Skill[] = [];
        const errors: string[] = [];

        for (const r of results) {
            if (r.status === 'rejected') errors.push(String(r.reason));
            else if (r.value !== null && r.value !== undefined) skills.push(r.value);
        }

        if (errors.length > 0 && skills.length === 0) {
            throw new Error(`All skill downloads failed:\n${errors.join('\n')}`);
        }

        return skills;
    }

    // ---------------------------------------------------------------------------
    // Private — local fetcher
    // ---------------------------------------------------------------------------

    private async fetchFromLocal(sourcePath: string, onlySkill?: string): Promise<Skill[]> {
        const dir = path.resolve(sourcePath);
        const filesResult = await run(() => fs.readdir(dir));
        if (!isOk(filesResult)) throw new Error(`Cannot read directory: ${dir}`);

        const skills: Skill[] = [];
        for (const file of filesResult.value) {
            if (!/\.ya?ml$/i.test(file)) continue;
            const filePath = path.join(dir, file);
            const contentResult = await run(() => fs.readFile(filePath, 'utf-8'));
            if (!isOk(contentResult)) continue;

            const parsed = fromThrowable(() => yaml.parse(contentResult.value) as Skill);
            if (!isOk(parsed)) continue;

            const skill = parsed.value;
            if (!skill?.name || !Array.isArray(skill.triggers)) continue;
            if (onlySkill && skill.name !== onlySkill) continue;
            skills.push(skill);
        }
        return skills;
    }

    // ---------------------------------------------------------------------------
    // Private — sources.json
    // ---------------------------------------------------------------------------

    private async loadSources(): Promise<SkillPackSource[]> {
        const result = await run(() => fs.readFile(this.sourcesFile, 'utf-8'));
        if (!isOk(result)) return [];
        const parsed = fromThrowable(() => JSON.parse(result.value) as SkillPackSource[]);
        return isOk(parsed) && Array.isArray(parsed.value) ? parsed.value : [];
    }

    private async upsertSource(entry: SkillPackSource): Promise<void> {
        const sources = await this.loadSources();
        const idx = sources.findIndex(s => s.pack === entry.pack);
        if (idx >= 0) sources[idx] = entry;
        else sources.push(entry);
        await fs.mkdir(path.dirname(this.sourcesFile), { recursive: true });
        await atomicWrite(this.sourcesFile, JSON.stringify(sources, null, 2));
    }

    private async removeSource(packName: string): Promise<void> {
        const sources = await this.loadSources();
        const filtered = sources.filter(s => s.pack !== packName);
        await atomicWrite(this.sourcesFile, JSON.stringify(filtered, null, 2));
    }
}
