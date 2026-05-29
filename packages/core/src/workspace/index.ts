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
}

export type WorkspacesConfig = Record<string, WorkspaceEntry>;

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

// ── Immutable CRUD ────────────────────────────────────────────────────────────

export function createWorkspace(config: WorkspacesConfig, name: string): WorkspacesConfig {
    if (config[name]) return config;
    return { ...config, [name]: { projects: [] } };
}

export function addProject(
    config: WorkspacesConfig,
    workspaceName: string,
    project: WorkspaceProject,
): WorkspacesConfig {
    const ws = config[workspaceName] ?? { projects: [] };
    if (ws.projects.some(p => p.cwd === project.cwd)) return config;
    const updated: WorkspaceEntry = {
        projects: [...ws.projects, project],
        active: ws.active ?? project.name,
    };
    return { ...config, [workspaceName]: updated };
}

export function removeProject(
    config: WorkspacesConfig,
    workspaceName: string,
    projectName: string,
): WorkspacesConfig {
    const ws = config[workspaceName];
    if (!ws) return config;
    const projects = ws.projects.filter(p => p.name !== projectName);
    const active = ws.active === projectName ? (projects[0]?.name ?? undefined) : ws.active;
    return { ...config, [workspaceName]: { projects, active } };
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

// ── Context builder ───────────────────────────────────────────────────────────

/**
 * Builds a context string for injection into the agent's system prompt.
 * Reads memory/contexto-proyecto.md from each project's data directory.
 */
export async function buildWorkspaceContext(
    name: string,
    entry: WorkspaceEntry,
    appName: string,
): Promise<string> {
    const projectList = entry.projects
        .map(p => `- **${p.name}**${p.name === entry.active ? ' *(active)*' : ''} — \`${p.cwd}\``)
        .join('\n');

    const parts: string[] = [`## Workspace: ${name}\n${projectList}`];

    for (const project of entry.projects) {
        const projectDir = getProjectDir(appName, project.cwd);
        const contextPath = path.join(projectDir, 'memory', 'contexto-proyecto.md');
        try {
            const content = (await fs.readFile(contextPath, 'utf-8')).trim();
            if (content) parts.push(`### ${project.name} — Context\n${content}`);
        } catch { /* no context yet for this project */ }
    }

    return parts.join('\n\n');
}
