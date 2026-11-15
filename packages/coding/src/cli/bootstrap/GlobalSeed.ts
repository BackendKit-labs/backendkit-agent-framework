import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { getFrameworkDir, cwdToProjectKey } from '@backendkit-labs/agent-core';
import { DEFAULT_CONFIG } from './config';
import { skillToMd } from '../skills/parse-md-skill';
import type { Skill } from '@backendkit-labs/agent-core';
import type { AgentProfile } from '@backendkit-labs/agent-core';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SeedResult {
    createdConfig:  boolean;
    createdUserMd:  boolean;
    createdAgentMd: boolean;
    createdDirs:    string[];
    seededAgents:   string[];
    seededSkills:   number;
}

export interface GlobalSeedOptions {
    /**
     * Agents to seed as .json + .md pairs on first run so users can discover
     * and customize them. Pass CODING_AGENTS here.
     * Only writes files that don't already exist — safe to call on every startup.
     */
    agents?: AgentProfile[];
    /**
     * Skills to seed as YAML files on first run so users can discover and
     * customize them. Pass all builtin skills (global + packs).
     * The engine always loads skills from memory — seeding is optional UX scaffolding.
     */
    skills?: Skill[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fileExists(p: string): Promise<boolean> {
    return fs.access(p).then(() => true).catch(() => false);
}

async function ensureDir(dir: string, created: string[]): Promise<void> {
    try {
        await fs.mkdir(dir, { recursive: true });
        created.push(dir);
    } catch { /* already exists */ }
}

// ── Templates ─────────────────────────────────────────────────────────────────

function buildUserMdTemplate(appName: string): string {
    return `# Developer Preferences

> Edited by the user — the agent reads this file at startup.

## Communication style
- Concise, direct responses
- No summary at the end of each response
- Code without obvious comments

## Preferred stack
- <!-- E.g.: Node.js + TypeScript, Python, Go -->

## Conventions
- <!-- E.g.: conventional commits, kebab-case for files -->

## What I DON'T want
- Emojis in code
- Feature flags for direct changes
- Speculative error handling

## Additional notes
- <!-- Any specific preferences for ${appName} -->
`;
}

function buildAgentMdTemplate(projectName: string): string {
    return `# ${projectName} — Project Instructions

> Edited by the team — the agent reads this file on every session.

## Stack
- <!-- E.g.: Node.js 20, TypeScript 5.7, NestJS 11, PostgreSQL -->

## Conventions
- <!-- Folder structure, used patterns, naming -->

## Project rules
- <!-- What the agent MUST and MUST NOT do here -->

## Business context
- <!-- Domain, key entities, main flows -->
`;
}

const AGENTS_README = `# Custom Agents

Place \`.json + .md\` file pairs here to define or override agents.

## Format

**{id}.json** — metadata:
\`\`\`json
{
  "id": "my-agent",
  "name": "My Agent",
  "icon": "◇",
  "description": "What this agent does",
  "allowedTools": ["read_file", "write_file", "run_command"],
  "delegatesTo": ["coder"]
}
\`\`\`

**{id}.md** — system prompt (overrides the json systemPrompt field):
\`\`\`
You are a specialist agent for...
\`\`\`

## Override a builtin
Drop only a \`.md\` file (no \`.json\`) to override just the system prompt
of an existing builtin agent while keeping its metadata.
`;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Idempotent initialization of the framework's global directory structure.
 * Runs at app startup — creates dirs and files only if they don't exist.
 *
 * Creates:
 *   ~/.{appName}/
 *   ├── config.json
 *   ├── USER.md
 *   ├── workspaces.json
 *   ├── agent-notes/
 *   ├── agents/          ← seeded from options.agents
 *   ├── skills/
 *   │   ├── sources.json
 *   │   ├── global/      ← global skills from options.skills
 *   │   └── packs/       ← pack skills from options.skills (grouped by skill.pack)
 *   └── projects/
 *       └── {cwd-slug}/
 *           ├── memory/
 *           └── audits/
 */
export async function runGlobalSeed(
    appName: string,
    cwd: string = process.cwd(),
    options: GlobalSeedOptions = {},
): Promise<SeedResult> {
    const globalDir    = getFrameworkDir(appName);
    const agentsDir    = path.join(globalDir, 'agents');
    const agentNotesDir= path.join(globalDir, 'agent-notes');
    const skillsDir    = path.join(globalDir, 'skills');
    const skillsGlobal = path.join(skillsDir, 'global');
    const skillsPacks  = path.join(skillsDir, 'packs');
    const projectsDir  = path.join(globalDir, 'projects');
    const projectKey   = cwdToProjectKey(cwd);
    const projectDir   = path.join(projectsDir, projectKey);
    const projectName  = path.basename(cwd);

    const result: SeedResult = {
        createdConfig:  false,
        createdUserMd:  false,
        createdAgentMd: false,
        createdDirs:    [],
        seededAgents:   [],
        seededSkills:   0,
    };

    // ── 1. Core directory structure ───────────────────────────────────────────
    const coreDirs = [
        globalDir,
        agentsDir,
        agentNotesDir,
        skillsDir,
        skillsGlobal,
        skillsPacks,
        projectsDir,
        projectDir,
        path.join(projectDir, 'memory'),
        path.join(projectDir, 'audits'),
        path.join(projectDir, 'skills'),
        path.join(projectDir, 'checkpoints'),
    ];
    await Promise.all(coreDirs.map(d => ensureDir(d, result.createdDirs)));

    // ── 2. config.json ────────────────────────────────────────────────────────
    const configPath = path.join(globalDir, 'config.json');
    if (!(await fileExists(configPath))) {
        await fs.writeFile(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
        result.createdConfig = true;
    }

    // ── 3. USER.md ────────────────────────────────────────────────────────────
    const userMdPath = path.join(globalDir, 'USER.md');
    if (!(await fileExists(userMdPath))) {
        await fs.writeFile(userMdPath, buildUserMdTemplate(appName), 'utf-8');
        result.createdUserMd = true;
    }

    // ── 4. workspaces.json ────────────────────────────────────────────────────
    const workspacesPath = path.join(globalDir, 'workspaces.json');
    if (!(await fileExists(workspacesPath))) {
        await fs.writeFile(workspacesPath, JSON.stringify({}, null, 2), 'utf-8');
    }

    // ── 5. agents/README.md ───────────────────────────────────────────────────
    const agentsReadme = path.join(agentsDir, 'README.md');
    if (!(await fileExists(agentsReadme))) {
        await fs.writeFile(agentsReadme, AGENTS_README, 'utf-8');
    }

    // ── 6. AGENT.md in project root ───────────────────────────────────────────
    const agentMdPath = path.join(cwd, 'AGENT.md');
    if (!(await fileExists(agentMdPath))) {
        await fs.writeFile(agentMdPath, buildAgentMdTemplate(projectName), 'utf-8');
        result.createdAgentMd = true;
    }

    // ── 7. Seed agents (.json + .md pairs) ───────────────────────────────────
    // Re-seeds builtin prompts when the framework updates them, but only if the
    // user has not customized the file. Customization is detected by comparing
    // the current file content hash against the hash stored at seed time
    // (_builtinHash in the .json). If they match → factory default → safe to
    // update. If they differ → user-modified → leave it alone.
    const agentsToSeed = options.agents ?? [];
    await Promise.all(agentsToSeed.map(async (agent) => {
        const jsonPath = path.join(agentsDir, `${agent.id}.json`);
        const mdPath   = path.join(agentsDir, `${agent.id}.md`);

        const builtinHash = createHash('sha256').update(agent.systemPrompt).digest('hex').slice(0, 16);

        const [jsonExists, mdExists] = await Promise.all([
            fileExists(jsonPath),
            fileExists(mdPath),
        ]);

        // Read stored hash BEFORE overwriting .json
        const storedHash: string | undefined = jsonExists
            ? await fs.readFile(jsonPath, 'utf-8')
                .then(raw => (JSON.parse(raw) as Record<string, unknown>)._builtinHash as string)
                .catch(() => undefined)
            : undefined;

        // Always write/update metadata .json (never has user content)
        const { systemPrompt, source, systemPromptAddition, ...meta } = agent;
        await fs.writeFile(jsonPath, JSON.stringify({ ...meta, _builtinHash: builtinHash }, null, 2), 'utf-8');

        if (!mdExists) {
            // First seed — write prompt
            await fs.writeFile(mdPath, agent.systemPrompt, 'utf-8');
            result.seededAgents.push(agent.id);
            return;
        }

        if (!storedHash) {
            // Pre-hash seed (old install) — treat as factory default, update
            await fs.writeFile(mdPath, agent.systemPrompt, 'utf-8');
            result.seededAgents.push(agent.id);
            return;
        }

        // Compare current file content hash against what was originally seeded
        const currentContent = await fs.readFile(mdPath, 'utf-8');
        const currentHash = createHash('sha256').update(currentContent).digest('hex').slice(0, 16);

        if (currentHash === storedHash && storedHash !== builtinHash) {
            // File is still factory default but builtin has changed — update
            await fs.writeFile(mdPath, agent.systemPrompt, 'utf-8');
            result.seededAgents.push(agent.id);
        }
        // else: user modified (currentHash !== storedHash) → leave it alone
        //       or: already up to date (storedHash === builtinHash) → no-op
    }));

    // ── 8. Seed skills as YAML ────────────────────────────────────────────────
    if (options.skills && options.skills.length > 0) {
        await Promise.all(options.skills.map(async (skill) => {
            const dir = skill.scope === 'pack' && skill.pack
                ? path.join(skillsPacks, skill.pack)
                : skillsGlobal;
            await fs.mkdir(dir, { recursive: true });
            const skillPath = path.join(dir, `${skill.name}.md`);
            if (!(await fileExists(skillPath))) {
                await fs.writeFile(skillPath, skillToMd(skill), 'utf-8');
                result.seededSkills++;
            }
        }));

        // ── 9. skills/sources.json — registry of installed packs ─────────────
        const sourcesPath = path.join(skillsDir, 'sources.json');
        if (!(await fileExists(sourcesPath))) {
            const packs = [...new Set(
                options.skills
                    .filter(s => s.scope === 'pack' && s.pack)
                    .map(s => s.pack as string)
            )];
            const sources = packs.map(pack => ({
                pack,
                source: 'builtin',
                installedAt: new Date().toISOString(),
            }));
            await fs.writeFile(sourcesPath, JSON.stringify(sources, null, 2), 'utf-8');
        }
    }

    return result;
}
