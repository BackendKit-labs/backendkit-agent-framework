import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import { run, isOk, fromThrowable } from '@backendkit-labs/result';
import { getFrameworkDir, getProjectDir } from '../shared/utils/project-key';
import type { Skill, SkillScope } from './types';

export interface LoadedSkills {
    global: Skill[];
    packs: Skill[];
    project: Skill[];
}

/**
 * Loads skills from the 3-layer hierarchy stored under the app directory.
 *
 * Layer structure (appName = 'deepseek-code'):
 *   ~/.deepseek-code/skills/global/      ← language-agnostic, always active
 *   ~/.deepseek-code/skills/packs/{pack}/ ← installed language packs
 *   ~/.deepseek-code/projects/{key}/skills/ ← project-specific
 */
export class SkillLoader {
    constructor(private readonly appName: string) {}

    /** Loads language-agnostic global skills */
    async loadGlobal(): Promise<Skill[]> {
        const dir = path.join(getFrameworkDir(this.appName), 'skills', 'global');
        return this.loadFromDir(dir, 'global');
    }

    /** Loads all installed pack skills from ~/.{appName}/skills/packs/ */
    async loadPacks(): Promise<Skill[]> {
        const packsDir = path.join(getFrameworkDir(this.appName), 'skills', 'packs');
        const accessResult = await run(() => fs.access(packsDir));
        if (!isOk(accessResult)) return [];

        const entries = await run(() => fs.readdir(packsDir, { withFileTypes: true }));
        if (!isOk(entries)) return [];

        const skills: Skill[] = [];
        for (const entry of entries.value) {
            if (!entry.isDirectory()) continue;
            const packDir = path.join(packsDir, entry.name);
            const packSkills = await this.loadFromDir(packDir, 'pack', entry.name);
            skills.push(...packSkills);
        }
        return skills;
    }

    /**
     * Loads project-specific skills from inside the project directory.
     * Path: {cwd}/.{appName}/skills/*.yaml
     *
     * Skills live alongside the project code so they are git-tracked and
     * shared across the team — consistent with how AgentLoader loads
     * project agents from {cwd}/.{appName}/agents/.
     */
    async loadProject(cwd: string): Promise<Skill[]> {
        const dir = path.join(cwd, `.${this.appName}`, 'skills');
        return this.loadFromDir(dir, 'project');
    }

    /** Loads all 3 layers at once */
    async loadAll(cwd?: string): Promise<LoadedSkills> {
        const [global, packs, project] = await Promise.all([
            this.loadGlobal(),
            this.loadPacks(),
            cwd ? this.loadProject(cwd) : Promise.resolve([]),
        ]);
        return { global, packs, project };
    }

    private async loadFromDir(
        dir: string,
        scope: SkillScope,
        pack?: string,
    ): Promise<Skill[]> {
        const accessResult = await run(() => fs.access(dir));
        if (!isOk(accessResult)) return [];

        const filesResult = await run(() => fs.readdir(dir));
        if (!isOk(filesResult)) return [];

        const skills: Skill[] = [];
        for (const file of filesResult.value) {
            if (!/\.(yaml|yml)$/.test(file)) continue;
            const filePath = path.join(dir, file);
            const contentResult = await run(() => fs.readFile(filePath, 'utf-8'));
            if (!isOk(contentResult)) continue;

            const parseResult = fromThrowable(() => yaml.parse(contentResult.value) as Skill);
            if (!isOk(parseResult) || !parseResult.value?.name) continue;

            skills.push({ ...parseResult.value, scope, ...(pack ? { pack } : {}) });
        }
        return skills;
    }
}
