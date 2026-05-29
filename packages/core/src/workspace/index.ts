import * as fs from 'fs/promises';
import * as path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorkspaceInfo {
    name: string;
    memoryDir: string;
    isDefault: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const DEFAULT_WORKSPACE = 'default';

// ── Path helpers ──────────────────────────────────────────────────────────────

export function getWorkspaceMemoryDir(projectBaseDir: string, name: string): string {
    if (!name || name === DEFAULT_WORKSPACE) {
        return path.join(projectBaseDir, 'memory');
    }
    return path.join(projectBaseDir, 'workspaces', name, 'memory');
}

// ── Workspace CRUD ────────────────────────────────────────────────────────────

export async function listWorkspaces(projectBaseDir: string): Promise<WorkspaceInfo[]> {
    const result: WorkspaceInfo[] = [{
        name: DEFAULT_WORKSPACE,
        memoryDir: path.join(projectBaseDir, 'memory'),
        isDefault: true,
    }];

    const workspacesDir = path.join(projectBaseDir, 'workspaces');
    try {
        const entries = await fs.readdir(workspacesDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            result.push({
                name: entry.name,
                memoryDir: path.join(workspacesDir, entry.name, 'memory'),
                isDefault: false,
            });
        }
    } catch {
        // workspaces/ doesn't exist yet — normal for new projects
    }

    return result;
}

export async function ensureWorkspace(projectBaseDir: string, name: string): Promise<WorkspaceInfo> {
    const memoryDir = getWorkspaceMemoryDir(projectBaseDir, name);
    await fs.mkdir(path.join(memoryDir, 'checkpoints'), { recursive: true });
    return { name, memoryDir, isDefault: name === DEFAULT_WORKSPACE };
}

export async function readWorkspaceMemory(
    projectBaseDir: string,
    name: string,
): Promise<{ sessionContent: string; projectContext: string }> {
    const memoryDir = getWorkspaceMemoryDir(projectBaseDir, name);
    let sessionContent = '';
    let projectContext = '';
    try { sessionContent = await fs.readFile(path.join(memoryDir, 'session.md'), 'utf-8'); } catch {}
    try { projectContext = await fs.readFile(path.join(memoryDir, 'contexto-proyecto.md'), 'utf-8'); } catch {}
    return { sessionContent, projectContext };
}
