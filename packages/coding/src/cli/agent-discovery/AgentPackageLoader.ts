import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, extname } from 'path';
import { parse as parseYaml } from 'yaml';
import type { AgentProfile } from '@backendkit-labs/agent-core';
import type { AgentPackageFile } from './types';
import { getFrameworkDir } from '@backendkit-labs/agent-core';

const REQUIRED_FIELDS = ['id', 'name', 'description', 'systemPrompt', 'allowedTools'] as const;

/**
 * Load agent definitions from a directory.
 *
 * Supports two layouts:
 *   <dir>/my-agent.yaml           ← single-file agent
 *   <dir>/my-agent/agent.yaml     ← package-directory agent
 */
export function loadAgentsFromDir(
    dir: string,
    source: AgentProfile['source'],
): AgentProfile[] {
    if (!existsSync(dir)) return [];

    const agents: AgentProfile[] = [];

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        // Skip the registry cache sub-directory
        if (entry.name === 'registry') continue;

        let filePath: string | null = null;

        if (entry.isFile() && isYamlOrJson(entry.name)) {
            filePath = join(dir, entry.name);
        } else if (entry.isDirectory()) {
            const nested = join(dir, entry.name, 'agent.yaml');
            if (existsSync(nested)) filePath = nested;
        }

        if (!filePath) continue;

        const agent = parseAgentFile(filePath, source);
        if (agent) agents.push(agent);
    }

    return agents;
}

/**
 * Returns the global agents directory: ~/.{appName}/agents/. Resolved with getFrameworkDir like the rest of the
 * framework (trust file, AgentLoader), so every loader looks in the same home.
 */
export function globalAgentsDir(appName: string): string {
    return join(getFrameworkDir(appName), 'agents');
}

/**
 * Names of what a directory holds that `loadAgentsFromDir` would load, without opening or parsing any of it.
 * Used to say what an untrusted project left out.
 */
export function listAgentEntries(dir: string): string[] {
    if (!existsSync(dir)) return [];
    const names: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'registry') continue;
        if (entry.isFile() && isYamlOrJson(entry.name)) names.push(entry.name.replace(/\.(yaml|yml|json)$/, ''));
        else if (entry.isDirectory() && existsSync(join(dir, entry.name, 'agent.yaml'))) names.push(entry.name);
    }
    return names.sort();
}

/** Returns the project-local agents directory: {cwd}/.{appName}/agents/ */
export function projectAgentsDir(cwd: string, appName: string): string {
    return join(cwd, `.${appName}`, 'agents');
}

// ── Private ───────────────────────────────────────────────────────────────────

function parseAgentFile(
    filePath: string,
    source: AgentProfile['source'],
): AgentProfile | null {
    try {
        const content = readFileSync(filePath, 'utf-8');
        const raw: unknown = extname(filePath) === '.json'
            ? JSON.parse(content)
            : parseYaml(content);

        if (!validate(raw)) {
            console.warn(`[AgentDiscovery] Missing required fields in ${filePath} — skipped`);
            return null;
        }

        return { ...raw, source: raw.source ?? source };
    } catch (err) {
        console.warn(`[AgentDiscovery] Failed to parse ${filePath}: ${(err as Error).message}`);
        return null;
    }
}

function validate(raw: unknown): raw is AgentPackageFile {
    if (!raw || typeof raw !== 'object') return false;
    const r = raw as Record<string, unknown>;
    return REQUIRED_FIELDS.every(f => f in r) && Array.isArray(r.allowedTools);
}

function isYamlOrJson(name: string): boolean {
    return /\.(yaml|yml|json)$/.test(name);
}
