import * as fs from 'node:fs';
import * as path from 'node:path';
import { getFrameworkDir } from '../shared/utils/project-key';
import { atomicWriteSync } from '../shared/utils/atomic-write';

/**
 * Workspace trust (ADR-0006).
 *
 * The project layer (`{cwd}/.{appName}/agents`, `{cwd}/.{appName}/skills`) is content of the repository the user
 * opened, not of whoever operates the agent: a repo can ship an agent that replaces the built-in orchestrator, with
 * its own prompt and tools. It is loaded only when the user has trusted that project.
 *
 * Trust is by exact real path: trusting `~/code` does not trust `~/code/some-clone`. It lives in
 * `~/.{appName}/trusted-projects.json`, or applies to every path with `BK_TRUST_PROJECT=1` (CI, containers).
 * Reading never writes; only `trustProject` / `untrustProject` do, and they are for the user to call (the `/trust`
 * command), never for an agent or a skill.
 */

export const TRUST_FILE = 'trusted-projects.json';

export type TrustReason = 'env' | 'listed' | 'untrusted';

export interface TrustStatus {
    trusted: boolean;
    reason: TrustReason;
    /** The canonical path that was judged. */
    path: string;
}

interface TrustFile {
    version: 1;
    projects: string[];
}

export function trustFilePath(appName: string): string {
    return path.join(getFrameworkDir(appName), TRUST_FILE);
}

/** Absolute, real (symlinks resolved when the path exists), without a trailing separator. */
export function canonicalProjectPath(projectPath: string): string {
    const abs = path.resolve(projectPath);
    let real = abs;
    try {
        real = fs.realpathSync.native(abs);
    } catch {
        // a path that does not exist yet is judged as written
    }
    const root = path.parse(real).root;
    return real === root ? real : real.replace(/[\\/]+$/, '');
}

/** Comparison key: Windows paths are case-insensitive. */
function key(canonical: string): string {
    return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

/**
 * The trusted projects. A missing, unreadable or malformed file means nobody is trusted, never everybody:
 * an error must not widen trust.
 */
export function listTrustedProjects(appName: string): string[] {
    try {
        const parsed = JSON.parse(fs.readFileSync(trustFilePath(appName), 'utf-8')) as Partial<TrustFile> | null;
        if (!parsed || !Array.isArray(parsed.projects)) return [];
        return parsed.projects.filter((p): p is string => typeof p === 'string' && p.length > 0);
    } catch {
        return [];
    }
}

export function isProjectTrusted(
    appName: string,
    projectPath: string,
    env: Record<string, string | undefined> = process.env,
): TrustStatus {
    const canonical = canonicalProjectPath(projectPath);
    if (env['BK_TRUST_PROJECT'] === '1') return { trusted: true, reason: 'env', path: canonical };
    const wanted = key(canonical);
    const listed = listTrustedProjects(appName).some(p => key(canonicalProjectPath(p)) === wanted);
    return { trusted: listed, reason: listed ? 'listed' : 'untrusted', path: canonical };
}

function writeTrusted(appName: string, projects: string[]): void {
    const file = trustFilePath(appName);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const body: TrustFile = { version: 1, projects };
    atomicWriteSync(file, JSON.stringify(body, null, 2) + '\n');
    try { fs.chmodSync(file, 0o600); } catch { /* not supported on every platform */ }
}

/** Trusts a project (idempotent). Returns the canonical path that was recorded. */
export function trustProject(appName: string, projectPath: string): string {
    const canonical = canonicalProjectPath(projectPath);
    const current = listTrustedProjects(appName);
    if (!current.some(p => key(canonicalProjectPath(p)) === key(canonical))) {
        writeTrusted(appName, [...current, canonical]);
    }
    return canonical;
}

/** Stops trusting a project. Returns whether it was trusted. */
export function untrustProject(appName: string, projectPath: string): boolean {
    const wanted = key(canonicalProjectPath(projectPath));
    const current = listTrustedProjects(appName);
    const kept = current.filter(p => key(canonicalProjectPath(p)) !== wanted);
    if (kept.length === current.length) return false;
    writeTrusted(appName, kept);
    return true;
}

export interface ProjectLayerContents {
    /** `{cwd}/.{appName}` */
    dir: string;
    /** Agent ids defined or overridden by the project (`agents/*.json`, `agents/*.md`). */
    agents: string[];
    /** Skill names defined by the project (`skills/*.yaml|yml|md`). */
    skills: string[];
}

/**
 * What the project layer holds, to tell the user what was left out when the project is not trusted.
 * Only file names are read; nothing is parsed or loaded.
 */
export function projectLayerContents(appName: string, cwd: string): ProjectLayerContents {
    const dir = path.join(cwd, `.${appName}`);
    const names = (sub: string, ext: RegExp): string[] => {
        try {
            const found = fs.readdirSync(path.join(dir, sub)).filter(f => ext.test(f)).map(f => f.replace(ext, ''));
            return [...new Set(found)].sort();
        } catch {
            return [];
        }
    };
    return { dir, agents: names('agents', /\.(json|md)$/i), skills: names('skills', /\.(ya?ml|md)$/i) };
}

/** The warning shown when a project has a layer that was not loaded. `undefined` when there is nothing to say. */
export function untrustedLayerWarning(appName: string, cwd: string): string | undefined {
    const layer = projectLayerContents(appName, cwd);
    if (layer.agents.length === 0 && layer.skills.length === 0) return undefined;
    const parts = [
        layer.agents.length ? `${layer.agents.length} agent(s): ${layer.agents.join(', ')}` : '',
        layer.skills.length ? `${layer.skills.length} skill(s): ${layer.skills.join(', ')}` : '',
    ].filter(Boolean);
    return (
        `[Trust] This project is not trusted, so its own ${parts.join(' and ')} in ${layer.dir} were NOT loaded. ` +
        `Trust it with /trust add (or BK_TRUST_PROJECT=1) only if you trust whoever wrote that repository.`
    );
}
