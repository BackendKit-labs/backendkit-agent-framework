import * as fs from 'fs/promises';
import * as path from 'path';
import { getFrameworkDir, getProjectDir } from '../shared/utils/project-key';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorkspaceProject {
    name: string;
    cwd: string;
}

export interface WorkspaceEntry {
    projects: WorkspaceProject[];
    /** Name of the currently active project within this workspace. */
    active?: string;
    /**
     * Common ancestor directory for all projects in this workspace.
     * When set, the agent's workingDir is changed to commonRoot on switch
     * instead of to the active project's cwd, giving it access to all projects.
     * Auto-detected when adding a second project; can be overridden manually.
     */
    commonRoot?: string;
}

export type WorkspacesConfig = Record<string, WorkspaceEntry>;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the deepest directory that is an ancestor of all given absolute paths.
 * E.g. ['/dev/system/auth', '/dev/system/api'] → '/dev/system'
 */
export function detectCommonRoot(cwds: string[]): string {
    if (cwds.length === 0) return '/';
    const normalize = (p: string) => p.replace(/\\/g, '/').replace(/\/$/, '');
    const parts = cwds.map(c => normalize(c).split('/'));
    const shortest = parts.reduce((a, b) => a.length <= b.length ? a : b);
    const common: string[] = [];
    for (let i = 0; i < shortest.length; i++) {
        if (parts.every(p => p[i] === shortest[i])) {
            common.push(shortest[i]);
        } else {
            break;
        }
    }
    return common.join('/') || '/';
}

// ── Persistence ───────────────────────────────────────────────────────────────

const WORKSPACES_FILE = 'workspaces.json';

export async function loadWorkspaces(appName: string): Promise<WorkspacesConfig> {
    const filePath = path.join(getFrameworkDir(appName), WORKSPACES_FILE);
    try {
        const raw = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(raw) as WorkspacesConfig;
    } catch {
        return {};
    }
}

export async function saveWorkspaces(appName: string, config: WorkspacesConfig): Promise<void> {
    const dir = getFrameworkDir(appName);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, WORKSPACES_FILE), JSON.stringify(config, null, 2), 'utf-8');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Infers a project name from its filesystem path.
 * Uses the last non-empty path segment.
 *
 * @example deriveProjectName('/home/user/projects/my-app') → 'my-app'
 */
export function deriveProjectName(cwd: string): string {
    return cwd.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean).pop() ?? 'project';
}

// ── Immutable CRUD ────────────────────────────────────────────────────────────

export function createWorkspace(config: WorkspacesConfig, name: string): WorkspacesConfig {
    if (config[name]) return config;
    return { ...config, [name]: { projects: [] } };
}

/**
 * Adds a project to a workspace.
 * Silently skips if a project with the same cwd already exists.
 * Throws if workspace and project share the same name (would cause ambiguity in commands).
 */
export function addProject(
    config: WorkspacesConfig,
    workspaceName: string,
    project: WorkspaceProject,
): WorkspacesConfig {
    if (workspaceName === project.name) {
        throw new Error(`Workspace and project cannot have the same name ("${workspaceName}")`);
    }
    const ws = config[workspaceName] ?? { projects: [] };
    if (ws.projects.some(p => p.cwd === project.cwd)) return config;
    const projects = [...ws.projects, project];
    // Auto-detect commonRoot when there are 2+ projects and no manual override exists.
    // Re-detect every time a project is added so it stays accurate.
    const commonRoot = projects.length >= 2
        ? detectCommonRoot(projects.map(p => p.cwd))
        : ws.commonRoot;
    const updated: WorkspaceEntry = {
        projects,
        active: ws.active ?? project.name,
        ...(commonRoot ? { commonRoot } : {}),
    };
    return { ...config, [workspaceName]: updated };
}

/**
 * Like addProject but auto-creates the workspace if it doesn't exist.
 * Useful for onboarding scenarios where the workspace may not exist yet.
 */
export function importProject(
    config: WorkspacesConfig,
    workspaceName: string,
    project: WorkspaceProject,
): WorkspacesConfig {
    const withWs = config[workspaceName] ? config : createWorkspace(config, workspaceName);
    return addProject(withWs, workspaceName, project);
}

/**
 * Removes a project from a workspace.
 * Throws if it is the only project — deleting the workspace is required instead.
 */
export function removeProject(
    config: WorkspacesConfig,
    workspaceName: string,
    projectName: string,
): WorkspacesConfig {
    const ws = config[workspaceName];
    if (!ws) return config;
    if (ws.projects.length <= 1) {
        throw new Error(
            `Cannot remove the only project in workspace "${workspaceName}". ` +
            `Delete the workspace instead: /workspace delete ${workspaceName}`,
        );
    }
    const projects = ws.projects.filter(p => p.name !== projectName);
    const active = ws.active === projectName ? (projects[0]?.name ?? undefined) : ws.active;
    return { ...config, [workspaceName]: { projects, active } };
}

export function setCommonRoot(
    config: WorkspacesConfig,
    workspaceName: string,
    commonRoot: string | undefined,
): WorkspacesConfig {
    const ws = config[workspaceName];
    if (!ws) return config;
    const { commonRoot: _removed, ...rest } = ws;
    return { ...config, [workspaceName]: commonRoot ? { ...rest, commonRoot } : rest };
}

export function deleteWorkspace(config: WorkspacesConfig, name: string): WorkspacesConfig {
    const { [name]: _removed, ...rest } = config;
    return rest;
}

export function setActiveProject(
    config: WorkspacesConfig,
    workspaceName: string,
    projectName: string,
): WorkspacesConfig {
    const ws = config[workspaceName];
    if (!ws) return config;
    return { ...config, [workspaceName]: { ...ws, active: projectName } };
}

// ── Migration ─────────────────────────────────────────────────────────────────

/**
 * One-time migration for apps that stored a single `cwd` without workspaces.
 * If workspaces.json already exists (non-empty), this is a no-op.
 * Otherwise creates a default workspace with one project derived from `cwd`.
 *
 * @param appName   Framework app name (e.g. 'backendkit-agent')
 * @param cwd       The legacy working directory
 * @param wsName    Optional workspace name — defaults to the project folder name
 */
export async function migrateFromLegacy(
    appName: string,
    cwd: string,
    wsName?: string,
): Promise<WorkspacesConfig> {
    const existing = await loadWorkspaces(appName);
    if (Object.keys(existing).length > 0) return existing;

    const projectName   = deriveProjectName(cwd);
    const workspaceName = wsName ?? projectName;
    const migrated      = importProject({}, workspaceName, { name: projectName, cwd });
    await saveWorkspaces(appName, migrated);
    return migrated;
}

// ── Context builder ───────────────────────────────────────────────────────────

/**
 * Builds a context string for injection into the agent's system prompt.
 * Reads memory/contexto-proyecto.md and memory/session.md from each project's
 * data directory and includes them as structured context.
 */
export async function buildWorkspaceContext(
    name: string,
    entry: WorkspaceEntry,
    appName: string,
): Promise<string> {
    const projectList = entry.projects
        .map(p => `- **${p.name}**${p.name === entry.active ? ' *(active)*' : ''} — \`${p.cwd}\``)
        .join('\n');

    const rootLine = entry.commonRoot
        ? `\nShared root (workingDir): \`${entry.commonRoot}\`` +
          `\nUse relative paths from this root, e.g. \`${entry.projects[0]?.name ?? 'service'}/src/index.ts\``
        : '';

    const parts: string[] = [`## Workspace: ${name}${rootLine}\n${projectList}`];

    for (const project of entry.projects) {
        const projectDir = getProjectDir(appName, project.cwd);
        const projectParts: string[] = [];

        const contextPath = path.join(projectDir, 'memory', 'contexto-proyecto.md');
        try {
            const content = (await fs.readFile(contextPath, 'utf-8')).trim();
            if (content) projectParts.push(`**Context:**\n${content}`);
        } catch { /* no context yet */ }

        const sessionPath = path.join(projectDir, 'memory', 'session.md');
        try {
            const session = (await fs.readFile(sessionPath, 'utf-8')).trim();
            if (session) projectParts.push(`**Session:**\n${session}`);
        } catch { /* no session yet */ }

        if (projectParts.length > 0) {
            parts.push(`### ${project.name}\n${projectParts.join('\n\n')}`);
        }
    }

    return parts.join('\n\n');
}
