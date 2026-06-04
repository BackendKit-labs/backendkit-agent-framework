import { SkillActivator, SkillLoader } from '@backendkit-labs/agent-core';
import { GLOBAL_BUILTIN_SKILLS, NODE_PACK_SKILLS } from '@backendkit-labs/agent-coding';
import type { Skill } from '@backendkit-labs/agent-core';

export interface SkillSearchResult {
    name: string;
    description: string;
    scope: string;
    pack?: string;
    language?: string[];
    triggers: string[];
    active: boolean;
}

export async function skillsSearch(
    query: string,
    cwd: string,
    appName: string,
): Promise<SkillSearchResult[]> {
    const loader = new SkillLoader(appName);
    const activator = new SkillActivator();

    const [loaded, detectedStack] = await Promise.all([
        loader.loadAll(cwd),
        activator.detectStack(cwd),
    ]);

    const allSkills: Skill[] = [
        ...GLOBAL_BUILTIN_SKILLS,
        ...NODE_PACK_SKILLS,
        ...loaded.global,
        ...loaded.packs,
        ...loaded.project,
    ];

    const activeSkills = activator.activate(query, allSkills, detectedStack);
    const activeNames = new Set(activeSkills.map((s: Skill) => s.name));

    const lowerQuery = query.toLowerCase();
    const matched = allSkills.filter((skill: Skill) =>
        skill.name.toLowerCase().includes(lowerQuery) ||
        skill.description.toLowerCase().includes(lowerQuery) ||
        skill.triggers.some((t: string) => t.toLowerCase().includes(lowerQuery)),
    );

    const seen = new Set<string>();
    return matched
        .filter((skill: Skill) => {
            if (seen.has(skill.name)) return false;
            seen.add(skill.name);
            return true;
        })
        .map((skill: Skill) => ({
            name: skill.name,
            description: skill.description,
            scope: skill.scope ?? 'global',
            pack: skill.pack,
            language: skill.language,
            triggers: skill.triggers,
            active: activeNames.has(skill.name),
        }));
}
