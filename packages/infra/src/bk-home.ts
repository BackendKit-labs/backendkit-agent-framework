import * as path from 'node:path';
import * as os   from 'node:os';

/**
 * Resolves the BackendKit Platform home directory.
 *
 * Priority:
 *   1. BK_HOME env var  (explicit override — useful for server deploys or rename)
 *   2. ~/.backendkit/   (default)
 *
 * All platform components derive their paths from this single root.
 * bk-agent uses ~/.bk-agent/ for its own data (agents, skills, projects) —
 * that directory is separate and will be unified in a future migration.
 */
export function getBkHome(): string {
    // An empty/blank BK_HOME counts as unset (otherwise every path would be relative to the cwd);
    // a relative one is resolved so it does not change meaning when the cwd changes.
    const fromEnv = process.env.BK_HOME?.trim();
    return fromEnv ? path.resolve(fromEnv) : path.join(os.homedir(), '.backendkit');
}

/**
 * Names used as a single path segment (project, vault, component). Rejecting separators and
 * dot segments keeps every derived path inside BK_HOME.
 */
function segment(name: string): string {
    if (name === '' || name === '.' || name === '..' || /[\\/\u0000]/.test(name)) {
        throw new Error(`Invalid name for a BK_HOME path: ${JSON.stringify(name)}`);
    }
    return name;
}

/**
 * All well-known paths under BK_HOME.
 * Use these instead of building paths manually in each component.
 */
export const bkPaths = {
    /** Root of BK_HOME */
    home: () => getBkHome(),

    /** Per-project vault notes (codex-context-agent-v2) */
    vault: (projectName: string) =>
        path.join(getBkHome(), 'vaults', segment(projectName)),

    /** All vault notes root */
    vaultsDir: () => path.join(getBkHome(), 'vaults'),

    /** Shared vault across projects */
    sharedVault: () => path.join(getBkHome(), 'vaults', 'shared'),

    /** RAG index for a named vault */
    ragIndex: (vaultName: string) =>
        path.join(getBkHome(), 'rag', `${segment(vaultName)}.json`),

    /** All RAG indexes root */
    ragDir: () => path.join(getBkHome(), 'rag'),

    /** Runtime data for a specific component */
    data: (component: string) =>
        path.join(getBkHome(), 'data', segment(component)),

    /** Director-agent memory directory */
    directorMemory: () => path.join(getBkHome(), 'director'),

    /** Director goals file */
    directorGoals: () => path.join(getBkHome(), 'director', 'goals.json'),

    /** Director user model file */
    directorUserModel: () => path.join(getBkHome(), 'director', 'user-model.json'),

    // ── MemorySystem 3-tier ────────────────────────────────────────────────────

    /** Root directory for all MemorySystem files */
    memoryDir: () => path.join(getBkHome(), 'memory'),

    /** Episodic memory — log of actions, flows started, gates approved, outcomes */
    memoryEpisodic: () => path.join(getBkHome(), 'memory', 'episodic.json'),

    /** Semantic memory — user profile, org context, preferences */
    memorySemantic: () => path.join(getBkHome(), 'memory', 'semantic.json'),

    /** Procedural memory — learned patterns, routing shortcuts, successful flows */
    memoryProcedural: () => path.join(getBkHome(), 'memory', 'procedural.json'),

    // ── Skills ────────────────────────────────────────────────────────────────

    /** Root directory for platform-level skills (YAML files) */
    skillsDir: () => path.join(getBkHome(), 'skills'),

    // ── Config ────────────────────────────────────────────────────────────────

    /** Platform config directory */
    configDir: () => path.join(getBkHome(), 'config'),

    /** orchestrator-mcp-agent seed config */
    orchestratorMcpConfig: () => path.join(getBkHome(), 'config', 'orchestrator-mcp.yaml'),
};
