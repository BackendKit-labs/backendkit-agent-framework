import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { atomicWriteSync } from '../shared/utils/atomic-write';
import type { AgentProfile } from '../types';
import type { RemoteRegistryIndex, RemotePackageListing } from './types';

const INDEX_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetches and caches agent packages from a remote registry.
 *
 * Registry index format (served at registryUrl):
 * {
 *   "version": "1",
 *   "agents": [
 *     { "name": "@bk/agent-devops-aws", "version": "1.0.0",
 *       "description": "...", "downloadUrl": "https://..." }
 *   ]
 * }
 *
 * Each downloadUrl must return a valid agent.yaml body.
 */
export class RemoteAgentRegistry {
    constructor(
        private readonly registryUrl: string,
        private readonly cacheDir: string,
    ) {
        mkdirSync(cacheDir, { recursive: true });
    }

    /** Fetch the registry index (cached for 1 hour). */
    async fetchIndex(): Promise<RemoteRegistryIndex> {
        const cachePath = join(this.cacheDir, '_index.json');

        if (existsSync(cachePath)) {
            const wrapper = JSON.parse(readFileSync(cachePath, 'utf-8')) as {
                fetchedAt: number;
                data: RemoteRegistryIndex;
            };
            if (Date.now() - wrapper.fetchedAt < INDEX_CACHE_TTL_MS) {
                return wrapper.data;
            }
        }

        const resp = await fetch(this.registryUrl, { headers: { Accept: 'application/json' } });
        if (!resp.ok) {
            throw new Error(`Registry fetch failed ${resp.status}: ${resp.statusText}`);
        }
        const data = await resp.json() as RemoteRegistryIndex;
        atomicWriteSync(cachePath, JSON.stringify({ fetchedAt: Date.now(), data }, null, 2));
        return data;
    }

    /**
     * Download and cache a package by name.
     * Returns null and logs a warning if the package is not found or invalid.
     */
    async installPackage(packageName: string): Promise<AgentProfile | null> {
        const safeName = packageName.replace(/[@/]/g, '_');
        const packageDir = join(this.cacheDir, safeName);
        const agentPath = join(packageDir, 'agent.yaml');

        // Use cached version if available
        if (existsSync(agentPath)) {
            return this.parseYamlAgent(agentPath, packageName);
        }

        let pkg: RemotePackageListing | undefined;
        try {
            const index = await this.fetchIndex();
            pkg = index.agents.find(a => a.name === packageName);
        } catch (err) {
            console.warn(`[AgentDiscovery] Registry unavailable for "${packageName}": ${(err as Error).message}`);
            return null;
        }

        if (!pkg) {
            console.warn(`[AgentDiscovery] Package "${packageName}" not found in registry`);
            return null;
        }

        return this.downloadAndCache(pkg, packageDir, agentPath);
    }

    // ── Private ────────────────────────────────────────────────────────────────

    private async downloadAndCache(
        pkg: RemotePackageListing,
        packageDir: string,
        agentPath: string,
    ): Promise<AgentProfile | null> {
        const resp = await fetch(pkg.downloadUrl);
        if (!resp.ok) {
            throw new Error(`Download failed for "${pkg.name}" (${resp.status}): ${resp.statusText}`);
        }
        const content = await resp.text();
        mkdirSync(packageDir, { recursive: true });
        atomicWriteSync(agentPath, content);

        console.log(`[AgentDiscovery] Installed "${pkg.name}@${pkg.version}" → ${agentPath}`);
        return this.parseYamlAgent(agentPath, pkg.name);
    }

    private parseYamlAgent(filePath: string, packageName: string): AgentProfile | null {
        try {
            const raw = parseYaml(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
            if (!raw?.id || !raw?.systemPrompt || !Array.isArray(raw?.allowedTools)) {
                console.warn(`[AgentDiscovery] Invalid agent.yaml for package "${packageName}"`);
                return null;
            }
            return { ...(raw as unknown as AgentProfile), source: 'registry' };
        } catch (err) {
            console.warn(`[AgentDiscovery] Parse error for "${packageName}": ${(err as Error).message}`);
            return null;
        }
    }
}
