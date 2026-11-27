import * as fs from 'fs/promises';
import * as path from 'path';
import { run, isOk } from '@backendkit-labs/result';
import { getFrameworkDir } from '@backendkit-labs/agent-core';
import { atomicWrite } from '@backendkit-labs/agent-core';
import { assertSafeFileName } from './safe-name';
import { skillToMd } from './parse-md-skill';
import { GitHubProvider } from './providers/github';
import { LocalProvider } from './providers/local';
import { SkillsShProvider } from './providers/skills-sh';
import type { SkillSourceProvider } from './providers/types';
import type { Skill } from '@backendkit-labs/agent-core';
import type { SkillPackSource, TrustConfig } from './types';

export interface InstallOptions {
    /** Only install this specific skill from the source (by name) */
    skill?: string;
    /** Override the derived pack name */
    pack?: string;
    /** Overwrite if already installed */
    force?: boolean;
    /**
     * Install into a project-scoped directory instead of global packs.
     * Skills are written flat to {projectDir}/skills/ and tracked in
     * {projectDir}/skills/sources.json.
     * This covers: internet-installed skills, LearningRouter auto-generated skills,
     * and manually created project skills — all non-git-tracked.
     */
    projectDir?: string;
}

export interface InstalledPack extends SkillPackSource {
    /** Skill names found in this pack's directory */
    skills: string[];
}

const DEFAULT_MAX_PROMPT_BYTES = 20_000;

/**
 * Manages lifecycle of external skill packs: install, uninstall, list, update.
 *
 * Skills are stored as .md files with YAML frontmatter.
 *
 * Safety guarantee: disk is only modified after ALL network fetches succeed.
 * If a fetch fails mid-way, existing packs are untouched.
 *
 * Security: pass a TrustConfig to restrict which sources can be installed.
 *   const manager = new SkillManager('my-app', {
 *     allowedSources: ['https://github.com/my-org/', 'https://skills.sh/'],
 *   })
 *
 * Extend with custom sources:
 *   manager.use(new MyProvider())
 */
export class SkillManager {
    private readonly packsDir: string;
    private readonly sourcesFile: string;
    private readonly providers: SkillSourceProvider[];
    private readonly trust: TrustConfig;

    constructor(private readonly appName: string, trust: TrustConfig = {}) {
        const skillsDir = path.join(getFrameworkDir(appName), 'skills');
        this.packsDir = path.join(skillsDir, 'packs');
        this.sourcesFile = path.join(skillsDir, 'sources.json');
        this.trust = trust;
        this.providers = [
            new GitHubProvider(appName),
            new SkillsShProvider(appName),
            new LocalProvider(),
        ];
    }

    /**
     * Registers an additional source provider.
     * Registered providers take precedence over built-in ones.
     */
    use(provider: SkillSourceProvider): this {
        this.providers.unshift(provider);
        return this;
    }

    async install(source: string, options: InstallOptions = {}): Promise<void> {
        // Security gate — checked before any network activity
        this.assertTrusted(source);

        const packName = options.pack ?? this.derivePackName(source);

        // Project-scoped: flat install into {projectDir}/skills/
        // Global-scoped: install into ~/.{appName}/skills/packs/{pack}/
        const { projectDir } = options;
        const installDir = projectDir
            ? path.join(projectDir, 'skills')
            : this.packDir(packName);

        if (!options.force) {
            // For project-scoped, check if source is already in project sources.json
            const existingSources = projectDir
                ? await this.loadSourcesFrom(path.join(projectDir, 'skills', 'sources.json'))
                : await this.loadSources();
            const alreadyInstalled = existingSources.some(s => s.pack === packName);
            if (alreadyInstalled) {
                throw new Error(
                    `Pack '${packName}' is already installed. Use force: true or call update() to refresh.`,
                );
            }
        }

        const provider = this.providers.find(p => p.canHandle(source));
        if (!provider) {
            throw new Error(
                `No provider found for source: '${source}'.\n` +
                `Built-in providers: GitHub URLs (https://github.com/...), local paths (/abs or ./rel).\n` +
                `Register custom providers with manager.use(new MyProvider()).`,
            );
        }

        // Fetch everything into memory first — no disk writes until all succeed
        const raw = await provider.fetch(source, { skill: options.skill });

        if (raw.length === 0) {
            throw new Error(
                `No valid skills found in '${source}'` +
                (options.skill ? ` matching skill '${options.skill}'` : '') + '.',
            );
        }

        // Content sanitization — even trusted sources are bounded
        const skills = this.sanitize(raw, source);

        // Write to disk only after successful fetch and sanitization
        await fs.mkdir(installDir, { recursive: true });
        await Promise.all(
            skills.map(skill => {
                const filePath = path.join(installDir, `${skill.name}.md`);
                // belt and braces: the name was validated in sanitize(); the resolved path must still be inside installDir
                if (path.dirname(path.resolve(filePath)) !== path.resolve(installDir)) {
                    throw new Error(`Unsafe skill name ${JSON.stringify(skill.name)}: resolves outside the install directory.`);
                }
                return atomicWrite(filePath, skillToMd(skill));
            }),
        );

        const entry: SkillPackSource = { pack: packName, source, installedAt: new Date().toISOString() };
        if (projectDir) {
            await this.upsertSourceTo(path.join(projectDir, 'skills', 'sources.json'), entry);
        } else {
            await this.upsertSource(entry);
        }
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
                        .filter(f => /\.(ya?ml|md)$/.test(f))
                        .map(f => f.replace(/\.(ya?ml|md)$/, ''))
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
    // Security
    // ---------------------------------------------------------------------------

    /**
     * Throws if the source is not in the allowlist.
     * When allowedSources is undefined the manager is in open mode — any source is accepted.
     */
    private assertTrusted(source: string): void {
        const { allowedSources } = this.trust;
        if (!allowedSources) return; // open mode

        // A prefix ends at a boundary: `https://github.com/my-org` admits `my-org/x`, not `my-org-evil/x` (audit D-14).
        const trusted = allowedSources.some(prefix => source === prefix || (source.startsWith(prefix) && (/[/?#:]$/.test(prefix) || /^[/?#]/.test(source.slice(prefix.length)))));
        if (!trusted) {
            throw new Error(
                `Source '${source}' is not in the trusted allowlist.\n` +
                `Allowed prefixes: ${allowedSources.join(', ')}\n` +
                `Pass the source to TrustConfig.allowedSources to authorize it.`,
            );
        }
    }

    /**
     * Validates content bounds on all skills from a source.
     * Prevents prompt-flooding even from trusted sources.
     */
    private sanitize(skills: Skill[], source: string): Skill[] {
        const maxBytes = this.trust.maxPromptBytes ?? DEFAULT_MAX_PROMPT_BYTES;
        for (const skill of skills) {
            assertSafeFileName('skill name', skill.name);
            if (!skill.systemPromptAddition) continue;
            const bytes = Buffer.byteLength(skill.systemPromptAddition, 'utf-8');
            if (bytes > maxBytes) {
                throw new Error(
                    `Skill '${skill.name}' from '${source}' exceeds the allowed prompt size.\n` +
                    `Got ${bytes} bytes, limit is ${maxBytes} bytes.\n` +
                    `Raise TrustConfig.maxPromptBytes if this source is intentionally verbose.`,
                );
            }
        }
        return skills;
    }

    // ---------------------------------------------------------------------------
    // Private
    // ---------------------------------------------------------------------------

    private derivePackName(source: string): string {
        const githubMatch = source.match(/github\.com\/([^/]+)\/([^/?#]+)/i);
        if (githubMatch) return `@${githubMatch[1]}`;
        const skillsShMatch = source.match(/skills\.sh\/([^/?#]+)\/([^/?#]+)/i);
        if (skillsShMatch) return `@${skillsShMatch[1]}/${skillsShMatch[2]}`;
        if (source.startsWith('obsidian://')) {
            const params = new URLSearchParams(source.split('?')[1] ?? '');
            return `obsidian-${params.get('folder')?.replace(/\//g, '-') ?? 'vault'}`;
        }
        return path.basename(source);
    }

    private packDir(packName: string): string {
        const dirName = packName.replace(/\//g, '-');
        assertSafeFileName('pack name', dirName);
        return path.join(this.packsDir, dirName);
    }

    private async loadSources(): Promise<SkillPackSource[]> {
        return this.loadSourcesFrom(this.sourcesFile);
    }

    private async loadSourcesFrom(file: string): Promise<SkillPackSource[]> {
        const result = await run(() => fs.readFile(file, 'utf-8'));
        if (!isOk(result)) return [];
        try {
            const parsed = JSON.parse(result.value) as SkillPackSource[];
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    private async upsertSource(entry: SkillPackSource): Promise<void> {
        return this.upsertSourceTo(this.sourcesFile, entry);
    }

    private async upsertSourceTo(file: string, entry: SkillPackSource): Promise<void> {
        const sources = await this.loadSourcesFrom(file);
        const idx = sources.findIndex(s => s.pack === entry.pack);
        if (idx >= 0) sources[idx] = entry;
        else sources.push(entry);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await atomicWrite(file, JSON.stringify(sources, null, 2));
    }

    private async removeSource(packName: string): Promise<void> {
        const sources = await this.loadSources();
        const filtered = sources.filter(s => s.pack !== packName);
        await atomicWrite(this.sourcesFile, JSON.stringify(filtered, null, 2));
    }
}

/**
 * Standard factory for SkillManager.
 * Use this instead of `new SkillManager()` in agent implementations.
 *
 * - Reads TrustConfig from env vars so security is configured at the host level:
 *     BK_TRUSTED_SOURCES  — comma-separated source prefixes (open mode if unset)
 *     BK_MAX_PROMPT_BYTES — max bytes for systemPromptAddition (default: 20 000)
 *
 * - ObsidianProvider is NOT registered by default — call `.use(new ObsidianProvider())`
 *   when the agent needs vault access (it requires a user-specific vault path).
 *
 * @example
 * // Basic — open mode, all built-in sources
 * const manager = createSkillManager('my-app');
 *
 * // With allowlist
 * const manager = createSkillManager('my-app', {
 *   allowedSources: ['https://github.com/my-org/', 'https://skills.sh/'],
 * });
 *
 * // With Obsidian support
 * const manager = createSkillManager('my-app').use(new ObsidianProvider());
 */
export function createSkillManager(appName: string, trust?: TrustConfig): SkillManager {
    const resolvedTrust: TrustConfig = { ...trust };

    if (!resolvedTrust.allowedSources) {
        const env = process.env.BK_TRUSTED_SOURCES;
        if (env) {
            resolvedTrust.allowedSources = env.split(',').map(s => s.trim()).filter(Boolean);
        }
    }

    if (!resolvedTrust.maxPromptBytes) {
        const env = process.env.BK_MAX_PROMPT_BYTES;
        if (env) {
            const parsed = parseInt(env, 10);
            if (!isNaN(parsed)) resolvedTrust.maxPromptBytes = parsed;
        }
    }

    return new SkillManager(appName, resolvedTrust);
}
