import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { atomicWriteSync } from '@backendkit-labs/agent-core';
import { assertSafeDownloadUrl } from './download-guard';
import { assertSafeFileName } from '../skills/safe-name';
import type { AgentProfile } from '@backendkit-labs/agent-core';
import type { RemoteRegistryIndex, RemotePackageListing } from './types';
import { readLimited } from '../read-limited';

const INDEX_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Largest agent.yaml accepted, in bytes. A profile is a few KB: more is not an agent. */
export const MAX_PACKAGE_BYTES = 256 * 1024;
/** Largest registry index accepted, in bytes. */
export const MAX_INDEX_BYTES = 2 * 1024 * 1024;

/** Tools that change files or run commands: a downloaded profile that asks for them is said so. */
const POWERFUL_TOOLS = ['run_command', 'write_file', 'edit_file'];

export interface RemoteAgentRegistryOptions {
    /**
     * Refuse a package whose listing in the index has no `sha256`. Default false: without a hash the file is accepted
     * with a warning (a registry that does not publish hashes keeps working), but nothing proves it is the one the
     * registry meant to publish. With a hash, the download is always checked.
     */
    requireIntegrity?: boolean;
}

/** What is kept next to a cached package, to know it is still what was downloaded. */
interface PackageMeta {
    name: string;
    version: string;
    sha256: string;
    /** The index listed a hash and the file matched it. */
    verified: boolean;
}

/**
 * The directory name of a package in the cache. The name comes from the configuration of whoever operates the agent and
 * goes into a path: separators and drive colons become `_`, and "." and ".." (and NUL, and too long a name) are refused.
 */
export function packageDirName(packageName: string): string {
    const dir = packageName.replace(/[@/\\:]/g, '_');
    assertSafeFileName('package name', dir);
    return dir;
}

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');


/**
 * Fetches and caches agent packages from a remote registry.
 *
 * Registry index format (served at registryUrl):
 * {
 *   "version": "1",
 *   "agents": [
 *     { "name": "@bk/agent-devops-aws", "version": "1.0.0",
 *       "description": "...", "downloadUrl": "https://...", "sha256": "<hex of the agent.yaml>" }
 *   ]
 * }
 *
 * Each downloadUrl must return a valid agent.yaml body. With `sha256` in the listing the file is checked against it; the
 * file is also size-limited, and a cached package is checked against the hash recorded when it was downloaded.
 */
export class RemoteAgentRegistry {
    constructor(
        private readonly registryUrl: string,
        private readonly cacheDir: string,
        private readonly options: RemoteAgentRegistryOptions = {},
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
        const data = JSON.parse(await readLimited(resp, MAX_INDEX_BYTES, 'The registry index')) as RemoteRegistryIndex;
        atomicWriteSync(cachePath, JSON.stringify({ fetchedAt: Date.now(), data }, null, 2));
        return data;
    }

    /**
     * Download and cache a package by name.
     * Returns null and logs a warning if the package is not found or invalid.
     */
    async installPackage(packageName: string): Promise<AgentProfile | null> {
        const packageDir = join(this.cacheDir, packageDirName(packageName));
        const agentPath = join(packageDir, 'agent.yaml');
        const metaPath = join(packageDir, 'agent.meta.json');

        // A cached package is reused only if it is still what was downloaded.
        if (existsSync(agentPath)) {
            const cached = this.cachedPackage(agentPath, metaPath);
            if (cached === 'ok') return this.parseYamlAgent(agentPath, packageName);
            console.warn(`[AgentDiscovery] The cached copy of "${packageName}" is not trusted (${cached}): downloading it again`);
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

        return this.downloadAndCache(pkg, packageDir, agentPath, metaPath);
    }

    // ── Private ────────────────────────────────────────────────────────────────

    /** Is the cached file the one that was downloaded (its hash is in the meta file), and does it satisfy `requireIntegrity`? */
    private cachedPackage(agentPath: string, metaPath: string): 'ok' | string {
        let meta: PackageMeta;
        try {
            meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as PackageMeta;
        } catch {
            return 'no record of its hash';
        }
        if (typeof meta.sha256 !== 'string' || sha256(readFileSync(agentPath)) !== meta.sha256) return 'the file changed after it was downloaded';
        if (this.options.requireIntegrity && !meta.verified) return 'it was downloaded without a hash to check';
        return 'ok';
    }

    private async downloadAndCache(
        pkg: RemotePackageListing,
        packageDir: string,
        agentPath: string,
        metaPath: string,
    ): Promise<AgentProfile | null> {
        // downloadUrl comes from the registry index: check it, and refuse redirects (they skip the check).
        await assertSafeDownloadUrl(pkg.downloadUrl, this.registryUrl);
        const resp = await fetch(pkg.downloadUrl, { redirect: 'error' });
        if (!resp.ok) {
            throw new Error(`Download failed for "${pkg.name}" (${resp.status}): ${resp.statusText}`);
        }
        const content = await readLimited(resp, MAX_PACKAGE_BYTES, `The package "${pkg.name}"`);
        const actual = sha256(content);

        let verified = false;
        if (typeof pkg.sha256 === 'string' && pkg.sha256.length > 0) {
            if (pkg.sha256.toLowerCase() !== actual) {
                throw new Error(`Integrity check failed for "${pkg.name}": the file is not the one the registry listed (sha256 ${actual.slice(0, 12)}..., listed ${pkg.sha256.slice(0, 12)}...). Nothing was installed.`);
            }
            verified = true;
        } else if (this.options.requireIntegrity) {
            throw new Error(`"${pkg.name}" has no sha256 in the registry index and requireIntegrity is on. Nothing was installed.`);
        } else {
            console.warn(`[AgentDiscovery] "${pkg.name}" has no sha256 in the registry index: nothing proves this is the file the registry meant to publish.`);
        }

        mkdirSync(packageDir, { recursive: true });
        atomicWriteSync(agentPath, content);
        const meta: PackageMeta = { name: pkg.name, version: pkg.version, sha256: actual, verified };
        atomicWriteSync(metaPath, JSON.stringify(meta, null, 2));

        console.log(`[AgentDiscovery] Installed "${pkg.name}@${pkg.version}" → ${agentPath}${verified ? ' (sha256 verified)' : ''}`);
        return this.parseYamlAgent(agentPath, pkg.name);
    }

    private parseYamlAgent(filePath: string, packageName: string): AgentProfile | null {
        try {
            const raw = parseYaml(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
            if (!raw?.id || !raw?.systemPrompt || !Array.isArray(raw?.allowedTools)) {
                console.warn(`[AgentDiscovery] Invalid agent.yaml for package "${packageName}"`);
                return null;
            }
            // What a downloaded profile may do is what it asks for: say it when it asks for tools that change files or run commands.
            const powerful = (raw.allowedTools as unknown[]).filter((t): t is string => typeof t === 'string' && POWERFUL_TOOLS.includes(t));
            if (powerful.length > 0) {
                console.warn(`[AgentDiscovery] The agent "${String(raw.id)}" from the registry asks for powerful tools: ${powerful.join(', ')}. Read its profile (${filePath}) before you let it work.`);
            }
            return { ...(raw as unknown as AgentProfile), source: 'registry' };
        } catch (err) {
            console.warn(`[AgentDiscovery] Parse error for "${packageName}": ${(err as Error).message}`);
            return null;
        }
    }
}
