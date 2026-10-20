import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { initBkHome, bkPaths } from '@backendkit-labs/infra';

export interface ProjectContext {
    projectName: string;
    projectRoot: string;
    vaultPath: string;
}

/**
 * Resolve the current project context.
 *
 * Priority for project root:
 *   1. CODEX_PROJECT_PATH env var (explicit manual override)
 *   2. CLAUDE_PROJECT_DIR env var — set by Claude Code itself on every spawned MCP
 *      server (project-scoped or user/global-scoped alike) to the active session's
 *      project root. This is what makes a single global mcpServers entry (registered
 *      once, used across every project) resolve to the right vault per project instead
 *      of needing a CODEX_PROJECT_PATH hardcoded per project.
 *   3. Git root detected from CWD
 *   4. CWD as fallback (non-git directories)
 *
 * Vault location: $BK_HOME/vaults/{project-name}/
 *   BK_HOME defaults to ~/.bk-agent/ — the unified platform infrastructure dir.
 *   Override with BK_HOME env var (e.g. for server deployments or rename).
 */
export async function resolveProject(): Promise<ProjectContext> {
    const startPath = process.env.CODEX_PROJECT_PATH ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

    let projectRoot: string;
    let projectName: string;

    try {
        const gitRoot = execSync('git rev-parse --show-toplevel', {
            cwd: startPath,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        projectRoot = gitRoot;
        projectName = path.basename(gitRoot);
    } catch {
        projectRoot = startPath;
        projectName = path.basename(startPath);
    }

    await initBkHome();
    const vaultPath = bkPaths.vault(projectName);
    await fs.mkdir(vaultPath, { recursive: true });

    return { projectName, projectRoot, vaultPath };
}

/**
 * Find a vault note by title (fuzzy filename match) or by relative path within the vault.
 */
export async function findNote(vaultPath: string, pathOrTitle: string): Promise<string> {
    // Treat as path if it looks like one
    if (pathOrTitle.includes('/') || pathOrTitle.includes('\\') || pathOrTitle.endsWith('.md')) {
        const resolved = path.resolve(vaultPath, pathOrTitle);
        // pathOrTitle comes from an MCP tool argument: never read outside the vault.
        const rel = path.relative(path.resolve(vaultPath), resolved);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            throw new Error(`Path is outside the vault: "${pathOrTitle}"`);
        }
        return await fs.readFile(resolved, 'utf-8');
    }

    // Search vault by filename containing the title
    const searchTerm = pathOrTitle.toLowerCase().replace(/\s+/g, '-');
    const found = await scanVaultForTitle(vaultPath, searchTerm);

    if (found.length === 0) {
        throw new Error(`Note not found in vault: "${pathOrTitle}"`);
    }

    // Return best match (most recently modified)
    const stats = await Promise.all(
        found.map(async f => ({ path: f, mtime: (await fs.stat(f)).mtime.getTime() }))
    );
    stats.sort((a, b) => b.mtime - a.mtime);

    return await fs.readFile(stats[0].path, 'utf-8');
}

async function scanVaultForTitle(dir: string, searchTerm: string): Promise<string[]> {
    const results: string[] = [];
    let entries: Dirent[];

    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return results;
    }

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
            results.push(...await scanVaultForTitle(fullPath, searchTerm));
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            if (entry.name.toLowerCase().includes(searchTerm)) {
                results.push(fullPath);
            }
        }
    }

    return results;
}
