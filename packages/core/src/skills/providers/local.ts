import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import { run, isOk, fromThrowable } from '@backendkit-labs/result';
import { parseMdSkill } from '../parse-md-skill';
import type { Skill } from '../types';
import type { FetchOptions, SkillSourceProvider } from './types';

const SKILL_FILE_RE = /\.(ya?ml|md)$/i;

/**
 * Fetches skills from a local filesystem directory.
 * Supports both .yaml/.yml and .md (with frontmatter) skill files.
 *
 * Accepted source formats:
 *   /absolute/path/to/skills
 *   ./relative/path/to/skills
 */
export class LocalProvider implements SkillSourceProvider {
    readonly id = 'local';

    canHandle(source: string): boolean {
        return source.startsWith('/') || source.startsWith('.') || /^[A-Za-z]:[/\\]/.test(source);
    }

    async fetch(source: string, options?: FetchOptions): Promise<Skill[]> {
        const dir = path.resolve(source);
        const filesResult = await run(() => fs.readdir(dir));
        if (!isOk(filesResult)) throw new Error(`Cannot read directory: ${dir}`);

        const skills: Skill[] = [];
        for (const file of filesResult.value) {
            if (!SKILL_FILE_RE.test(file)) continue;

            const filePath = path.join(dir, file);
            const contentResult = await run(() => fs.readFile(filePath, 'utf-8'));
            if (!isOk(contentResult)) continue;

            const skill = /\.md$/i.test(file)
                ? parseMdSkill(contentResult.value)
                : parseYamlSkill(contentResult.value);

            if (!skill?.name) continue;
            if (options?.skill && skill.name !== options.skill) continue;
            skills.push(skill);
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
