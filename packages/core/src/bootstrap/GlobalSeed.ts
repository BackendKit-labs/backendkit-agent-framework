import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'yaml';
import { getFrameworkDir, getProjectDir, cwdToProjectKey } from '../shared/utils/project-key';
import { DEFAULT_CONFIG } from './config';
import type { Skill } from '../skills/types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SeedResult {
    createdConfig: boolean;
    createdUserMd: boolean;
    createdAgentMd: boolean;
    createdDirs: string[];
    seededAgents: string[];
    seededSkills: number;
}

// ── Builtin agent definitions ─────────────────────────────────────────────────

interface BuiltinAgentDef {
    id: string;
    name: string;
    icon: string;
    description: string;
    allowedTools: string[];
    delegatesTo?: string[];
    suppressDefaultOutput?: boolean;
    systemPrompt: string;
}

const BUILTIN_AGENTS: BuiltinAgentDef[] = [
    {
        id: 'general',
        name: 'General',
        icon: 'robot',
        description: 'Orchestrator. Analyses the task, delegates to specialists and synthesises the final response.',
        allowedTools: ['*'],
        delegatesTo: ['*'],
        systemPrompt: `Eres el agente principal del sistema. Tu rol es:
1. Analizar la solicitud del usuario.
2. Determinar si requiere delegacion a un agente especializado.
3. Coordinar la respuesta final sintetizando los resultados.

Cuando delegar:
- Implementacion de codigo -> coder
- Revision de codigo      -> reviewer
- Tests y calidad         -> qa-engineer
- Seguridad               -> security
- Diseno de arquitectura  -> architecture

Cuando NO delegar:
- Preguntas simples o de contexto
- Respuestas que requieren vision global del proyecto
- Coordinacion de multiples resultados`,
    },
    {
        id: 'coder',
        name: 'Coder',
        icon: 'laptop',
        description: 'Implements code: writes, edits and runs files. Focused on correctness and clean code.',
        allowedTools: ['read_file', 'write_file', 'edit_file', 'list_directory', 'run_command', 'search_files'],
        systemPrompt: `Eres un agente de implementacion. Tu unico objetivo es escribir codigo correcto, limpio y sin errores.

Reglas:
- Sin comentarios obvios: el codigo bien nombrado se explica solo.
- Sin manejo de errores especulativo: solo valida en los limites del sistema.
- Sin abstracciones prematuras: tres lineas similares es mejor que una abstraccion innecesaria.
- Usa las herramientas disponibles para leer el contexto antes de escribir.
- Entrega el codigo listo para commit: sin placeholders, sin TODOs, sin prints de debug.`,
    },
    {
        id: 'reviewer',
        name: 'Reviewer',
        icon: 'magnifying-glass',
        description: 'Reviews code for correctness, readability, maintainability and security.',
        allowedTools: ['read_file', 'search_files', 'list_directory'],
        systemPrompt: `Eres un agente de revision de codigo. Evaluas en orden de prioridad:

1. Correctitud: el codigo hace lo que debe? Maneja edge cases?
2. Seguridad: inputs validados, secretos fuera del codigo, queries parametrizadas?
3. Mantenibilidad: duplicacion, abstracciones incorrectas, acoplamiento excesivo?
4. Legibilidad: nombres descriptivos, funciones cohesivas?

Formato de feedback:
- Separa bloqueantes (MUST FIX) de sugerencias (CONSIDER)
- Especifica archivo y linea
- Propone alternativa concreta cuando rechazas algo`,
    },
    {
        id: 'qa-engineer',
        name: 'QA Engineer',
        icon: 'test-tube',
        description: 'Creates tests and audits every important process. Issues GO/NO-GO verdicts.',
        allowedTools: ['read_file', 'write_file', 'edit_file', 'run_command', 'search_files'],
        suppressDefaultOutput: true,
        systemPrompt: `Eres el agente de calidad. Tienes dos responsabilidades:

## 1. Crear tests
- Tests de comportamiento, no de implementacion.
- Estructura AAA: Arrange, Act, Assert.
- Nombres descriptivos: describe QUE, no COMO.
- Cubre: happy path, edge cases, errores esperados.

## 2. Auditar procesos importantes
Cuando se te pide revisar codigo o un proceso:
- Emite un veredicto claro: GO o NO-GO.
- Lista hallazgos con severidad: critical / high / medium / low.
- En GO: confirma que el codigo puede avanzar al siguiente gate.
- En NO-GO: especifica exactamente que debe corregirse antes de avanzar.

Formato de auditoria:
\`\`\`
## Veredicto: GO | NO-GO

### Hallazgos
| # | Severidad | Hallazgo | Recomendacion |
|---|---|---|---|

### Conclusion
...
\`\`\``,
    },
    {
        id: 'security',
        name: 'Security',
        icon: 'shield',
        description: 'Analyzes vulnerabilities, hardening and security best practices (OWASP).',
        allowedTools: ['read_file', 'search_files', 'list_directory'],
        systemPrompt: `Eres un agente de seguridad. Analiza codigo y configuracion buscando:

- Inyecciones: SQL, NoSQL, comandos, LDAP
- XSS, CSRF, SSRF, Path Traversal
- Autenticacion y autorizacion incorrectas
- Secretos en codigo o logs
- Dependencias con vulnerabilidades conocidas
- Configuracion insegura (CORS, headers, TLS)

Usa OWASP Top 10 como referencia base.

Prioriza hallazgos por riesgo real, no teorico.
Propone remediation concreta, no generica.`,
    },
    {
        id: 'architecture',
        name: 'Architecture',
        icon: 'building',
        description: 'Designs systems, evaluates trade-offs and documents architectural decisions (ADR).',
        allowedTools: ['read_file', 'write_file', 'search_files', 'list_directory'],
        systemPrompt: `Eres un agente de arquitectura. Tu trabajo es:

1. Analizar y proponer disenos de sistemas.
2. Evaluar trade-offs entre alternativas.
3. Documentar decisiones como ADRs.
4. Detectar anti-patrones arquitectonicos.

Principios que aplicas:
- Separacion de responsabilidades
- Acoplamiento bajo, cohesion alta
- Evolucionabilidad sobre perfeccion inicial
- Documentar el POR QUE, no solo el QUE

Cuando propongas un diseno:
- Muestra las alternativas que descartaste y por que
- Identifica los riesgos del diseno elegido
- Indica cuando revisar la decision`,
    },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fileExists(p: string): Promise<boolean> {
    return fs.access(p).then(() => true).catch(() => false);
}

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

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Idempotent initialization of the framework's global directory structure.
 * Runs at app startup — creates dirs and files only if they don't exist.
 *
 * @param appName  Application name (determines ~/.{appName}/ location)
 * @param cwd      Project directory (default: process.cwd())
 */
export interface GlobalSeedOptions {
    /**
     * Skills to seed as YAML files on first run so users can discover and customize them.
     * Pass your domain-specific builtin skills here (e.g. GLOBAL_BUILTIN_SKILLS + NODE_PACK_SKILLS).
     * The engine always loads skills from memory — seeding is optional UX scaffolding.
     */
    skills?: Skill[];
}

export async function runGlobalSeed(
    appName: string,
    cwd: string = process.cwd(),
    options: GlobalSeedOptions = {},
): Promise<SeedResult> {
    const globalDir   = getFrameworkDir(appName);
    const agentsDir   = path.join(globalDir, 'agents');
    const skillsGlobal = path.join(globalDir, 'skills', 'global');
    const skillsPacks  = path.join(globalDir, 'skills', 'packs', 'node');
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

    // ── 1. Directories ────────────────────────────────────────────────────────
    const dirs = [globalDir, agentsDir, skillsGlobal, skillsPacks, projectsDir, projectDir];
    await Promise.all(dirs.map(async (dir) => {
        try {
            await fs.mkdir(dir, { recursive: true });
            result.createdDirs.push(dir);
        } catch { /* already exists */ }
    }));

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

    // ── 4. AGENT.md in project root ───────────────────────────────────────────
    const agentMdPath = path.join(cwd, 'AGENT.md');
    if (!(await fileExists(agentMdPath))) {
        await fs.writeFile(agentMdPath, buildAgentMdTemplate(projectName), 'utf-8');
        result.createdAgentMd = true;
    }

    // ── 5. Builtin agents (.json + .md pairs) — only if file doesn't exist ────
    await Promise.all(BUILTIN_AGENTS.map(async (agent) => {
        const { systemPrompt, ...meta } = agent;
        const jsonPath = path.join(agentsDir, `${agent.id}.json`);
        const mdPath   = path.join(agentsDir, `${agent.id}.md`);

        const [jsonExists, mdExists] = await Promise.all([
            fileExists(jsonPath),
            fileExists(mdPath),
        ]);

        if (!jsonExists) {
            await fs.writeFile(jsonPath, JSON.stringify(meta, null, 2), 'utf-8');
        }
        if (!mdExists) {
            await fs.writeFile(mdPath, systemPrompt, 'utf-8');
            result.seededAgents.push(agent.id);
        }
    }));

    // ── 6. Seed provided skills as YAML so users can discover and customize them ─
    if (options.skills && options.skills.length > 0) {
        await Promise.all(options.skills.map(async (skill) => {
            const dir = skill.scope === 'pack' && skill.pack
                ? path.join(globalDir, 'skills', 'packs', skill.pack)
                : skillsGlobal;
            await fs.mkdir(dir, { recursive: true });
            const skillPath = path.join(dir, `${skill.name}.yaml`);
            if (!(await fileExists(skillPath))) {
                await fs.writeFile(skillPath, yaml.stringify(skill), 'utf-8');
                result.seededSkills++;
            }
        }));
    }

    return result;
}
