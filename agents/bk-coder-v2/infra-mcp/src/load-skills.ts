import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { parseMdSkill } from '@backendkit-labs/agent-core';
import type { Skill } from '@backendkit-labs/agent-core';
import { bkPaths } from '@backendkit-labs/infra';

/** This agent's id — also the name of its isolated skill folder. */
const AGENT_ID = 'infrastructure';

function readSkillsFromDir(dir: string): Skill[] {
    let files: string[];
    try { files = readdirSync(dir).filter(f => /\.md$/i.test(f)); }
    catch { return []; }            // missing dir → no skills
    const out: Skill[] = [];
    for (const f of files) {
        try {
            const s = parseMdSkill(readFileSync(path.join(dir, f), 'utf-8'));
            if (s?.name) out.push(s);
        } catch { /* skip malformed file */ }
    }
    return out;
}

/**
 * Loads this agent's skills from the unified BK_HOME store in two tiers:
 *   ~/.backendkit/skills/global/           → shared by ALL agents (cross-cutting)
 *   ~/.backendkit/skills/infrastructure/   → THIS agent only (isolated — never mixed with others)
 * plus the per-project equivalents under <projectRoot>/.backendkit/skills/ when PROJECT_ROOT is set.
 *
 * Precedence (later overrides earlier on name collision):
 *   home/global < home/<agent> < project/global < project/<agent>
 */
export function loadInfraSkills(): Skill[] {
    const home        = bkPaths.skillsDir();              // ~/.backendkit/skills
    const projectRoot = process.env['PROJECT_ROOT'];

    const layers = [
        path.join(home, 'global'),
        path.join(home, AGENT_ID),
        ...(projectRoot ? [
            path.join(projectRoot, '.backendkit', 'skills', 'global'),
            path.join(projectRoot, '.backendkit', 'skills', AGENT_ID),
        ] : []),
    ];

    const byName = new Map<string, Skill>();
    for (const dir of layers)
        for (const s of readSkillsFromDir(dir)) byName.set(s.name, s);
    return [...byName.values()];
}
