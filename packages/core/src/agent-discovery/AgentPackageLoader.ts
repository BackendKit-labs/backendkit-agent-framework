import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, extname } from 'path';
import { homedir } from 'os';
import { parse as parseYaml } from 'yaml';
import type { AgentProfile } from '../types';
import type { AgentPackageFile } from './types';

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

/** Returns the global agents directory: ~/.{appName}/agents/ */
export function globalAgentsDir(appName: string): string {
    return join(homedir(), `.${appName}`, 'agents');
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
