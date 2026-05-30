import { SkillManager } from '@bk/agent-core';
import { GLOBAL_BUILTIN_SKILLS, NODE_PACK_SKILLS } from '@bk/agent-coding';
import type { Skill, InstalledPack } from '@bk/agent-core';

export interface PackSummary {
    pack: string;
    source: string;
    installedAt: string;
    skills: string[];
    builtin: boolean;
}

export async function skillsList(appName: string): Promise<PackSummary[]> {
    const manager = new SkillManager(appName);
    const installed = await manager.list();

    const builtins: PackSummary[] = [
        {
            pack: '@bk/global',
            source: 'builtin',
            installedAt: '-',
            skills: GLOBAL_BUILTIN_SKILLS.map((s: Skill) => s.name),
            builtin: true,
        },
        {
            pack: '@bk-node',
            source: 'builtin',
            installedAt: '-',
            skills: NODE_PACK_SKILLS.map((s: Skill) => s.name),
            builtin: true,
        },
    ];

    const external: PackSummary[] = installed.map((p: InstalledPack) => ({
        pack: p.pack,
        source: p.source,
        installedAt: p.installedAt,
        skills: p.skills,
        builtin: false,
    }));

    return [...builtins, ...external];
}
