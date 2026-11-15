import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import { run, isOk } from '@backendkit-labs/result';
import { parseMdSkill } from '../parse-md-skill';
import type { Skill } from '@backendkit-labs/agent-core';
import type { FetchOptions, SkillSourceProvider } from './types';

/**
 * Fetches skills from an Obsidian vault.
 * Skills are .md files with YAML frontmatter stored inside the vault.
 *
 * Source format:
 *   obsidian:///path/to/vault                         — scans vault root, filters by tag='skill'
 *   obsidian:///path/to/vault?folder=Coding/Skills    — scans folder, filters by tag='skill'
 *   obsidian:///path/to/vault?tag=agent-skill         — custom tag, scans vault root
 *   obsidian:///path/to/vault?folder=Skills&tag=      — folder only, no tag filter (tag= empty)
 *
 * Tag filter is always active (default: 'skill') unless explicitly disabled with ?tag= (empty).
 * This prevents loading every .md in the vault accidentally.
 *
 * On Windows, use forward slashes:
 *   obsidian:///C:/Users/name/Obsidian Vault?folder=Skills
 */
export class ObsidianProvider implements SkillSourceProvider {
    readonly id = 'obsidian';

    canHandle(source: string): boolean {
        return source.startsWith('obsidian://');
    }

    async fetch(source: string, options?: FetchOptions): Promise<Skill[]> {
        const { vaultPath, folder, tag } = this.parseSource(source);

        const scanDir = folder
            ? path.join(vaultPath, ...folder.split('/'))
            : vaultPath;

        const mdFiles = await this.collectMdFiles(scanDir);
        const skills: Skill[] = [];

        for (const filePath of mdFiles) {
            const contentResult = await run(() => fs.readFile(filePath, 'utf-8'));
            if (!isOk(contentResult)) continue;

            const skill = parseMdSkill(contentResult.value);
            if (!skill?.name || !Array.isArray(skill.triggers)) continue;

            if (tag && !this.hasTag(contentResult.value, tag)) continue;
            if (options?.skill && skill.name !== options.skill) continue;

            skills.push(skill);
        }

        return skills;
    }

    private parseSource(source: string): { vaultPath: string; folder?: string; tag?: string } {
        const withoutScheme = source.replace(/^obsidian:\/\//, '');
        const [rawPath, queryString] = withoutScheme.split('?');

        // Normalize Windows paths: /C:/Users/... → C:/Users/...
        const vaultPath = path.normalize(
            rawPath.startsWith('/') && /^\/[A-Za-z]:/.test(rawPath)
                ? rawPath.slice(1)
                : rawPath,
        );

        const params = new URLSearchParams(queryString ?? '');
        const folder = params.get('folder') ?? undefined;
        const tagParam = params.get('tag');

        // Tag filter is always on by default.
        // Disable explicitly with ?tag= (empty string) when using folder as the scope.
        const tag = tagParam === null ? 'skill' : (tagParam || undefined);

        return { vaultPath, folder, tag };
    }

    private async collectMdFiles(dir: string): Promise<string[]> {
        const entriesResult = await run(() => fs.readdir(dir, { withFileTypes: true }));
        if (!isOk(entriesResult)) return [];

        const files: string[] = [];
        for (const entry of entriesResult.value) {
            if (entry.name.startsWith('.')) continue; // skip .obsidian, .trash, etc.
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                files.push(...await this.collectMdFiles(fullPath));
            } else if (entry.isFile() && entry.name.endsWith('.md')) {
                files.push(fullPath);
            }
        }
        return files;
    }

    /**
     * Checks whether a file's frontmatter tags array includes the target tag.
     * Handles both inline (`tags: [a, b]`) and block (`tags:\n  - a`) YAML formats.
     */
    private hasTag(content: string, tag: string): boolean {
        const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!frontmatterMatch) return false;
        try {
            const parsed = yaml.parse(frontmatterMatch[1]) as Record<string, unknown>;
            const tags = parsed?.tags;
            if (Array.isArray(tags)) return tags.map(String).includes(tag);
            if (typeof tags === 'string') return tags === tag;
            return false;
        } catch {
            return false;
        }
    }
}
