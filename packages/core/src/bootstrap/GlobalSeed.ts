import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import { getFrameworkDir, cwdToProjectKey } from '../shared/utils/project-key';
import { DEFAULT_CONFIG } from './config';
import type { Skill } from '../skills/types';
import type { AgentProfile } from '../types';

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
    return `# Preferencias del Desarrollador

> Editado por el usuario — el agente lee este archivo al arrancar.

## Estilo de comunicacion
- Respuestas concisas y directas
- Sin resumen al final de cada respuesta
- Codigo sin comentarios obvios

## Stack preferido
- <!-- Ej: Node.js + TypeScript, Python, Go -->

## Convenciones
- <!-- Ej: conventional commits, kebab-case para archivos -->

## Lo que NO quiero
- Emojis en el codigo
- Feature flags para cambios directos
- Manejo de errores especulativo

## Notas adicionales
- <!-- Cualquier preferencia especifica para ${appName} -->
`;
}

function buildAgentMdTemplate(projectName: string): string {
    return `# ${projectName} — Instrucciones del Proyecto

> Editado por el equipo — el agente lee este archivo en cada sesion.

## Stack
- <!-- Ej: Node.js 20, TypeScript 5.7, NestJS 11, PostgreSQL -->

## Convenciones
- <!-- Estructura de carpetas, patrones usados, nombres -->

## Reglas de este proyecto
- <!-- Lo que el agente DEBE y NO DEBE hacer aqui -->

## Contexto de negocio
- <!-- Dominio, entidades clave, flujos principales -->
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
    const agentsToSeed = options.agents ?? [];
    await Promise.all(agentsToSeed.map(async (agent) => {
        const jsonPath = path.join(agentsDir, `${agent.id}.json`);
        const mdPath   = path.join(agentsDir, `${agent.id}.md`);

        const [jsonExists, mdExists] = await Promise.all([
            fileExists(jsonPath),
            fileExists(mdPath),
        ]);

        if (!jsonExists) {
            // Write metadata only (no runtime-only fields)
            const { systemPrompt, source, systemPromptAddition, ...meta } = agent;
            await fs.writeFile(jsonPath, JSON.stringify(meta, null, 2), 'utf-8');
        }
        if (!mdExists) {
            await fs.writeFile(mdPath, agent.systemPrompt, 'utf-8');
            result.seededAgents.push(agent.id);
        }
    }));

    // ── 8. Seed skills as YAML ────────────────────────────────────────────────
    if (options.skills && options.skills.length > 0) {
        await Promise.all(options.skills.map(async (skill) => {
            const dir = skill.scope === 'pack' && skill.pack
                ? path.join(skillsPacks, skill.pack)
                : skillsGlobal;
            await fs.mkdir(dir, { recursive: true });
            const skillPath = path.join(dir, `${skill.name}.yaml`);
            if (!(await fileExists(skillPath))) {
                await fs.writeFile(skillPath, yaml.stringify(skill), 'utf-8');
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
