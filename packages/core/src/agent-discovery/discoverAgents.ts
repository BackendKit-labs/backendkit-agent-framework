import { join } from 'path';
import { homedir } from 'os';
import type { AgentProfile } from '../types';
import type { AgentDiscoveryConfig } from './types';
import { loadAgentsFromDir, globalAgentsDir, projectAgentsDir } from './AgentPackageLoader';
import { RemoteAgentRegistry } from './RemoteAgentRegistry';

const DEFAULT_APP_NAME = 'bk-agent';

/**
 * Discover agents from local directories and/or a remote registry.
 *
 * Local layout (appName = 'bk-agent'):
 *   ~/.bk-agent/agents/                    ← global agents (shared across projects)
 *   {workingDir}/.bk-agent/agents/         ← project-local agents (git-tracked)
 *
 * Remote:
 *   Fetch the registry index, download requested packages, cache locally.
 *   Re-running is fast — cached packages are reused until deleted.
 *
 * Deduplication: if the same agent id appears in multiple sources,
 * the first occurrence wins (global → project → registry → static agents).
 */
export async function discoverAgents(config: AgentDiscoveryConfig): Promise<AgentProfile[]> {
    const appName = config.appName ?? DEFAULT_APP_NAME;
    const cwd = config.workingDir ?? process.cwd();
    const agents: AgentProfile[] = [];
    const seen = new Set<string>();

    const add = (incoming: AgentProfile[]) => {
        for (const a of incoming) {
            if (!seen.has(a.id)) {
                seen.add(a.id);
                agents.push(a);
            }
        }
    };

    // 1. Local: global agents
    if (config.local !== false) {
        add(loadAgentsFromDir(globalAgentsDir(appName), 'global'));
        add(loadAgentsFromDir(projectAgentsDir(cwd, appName), 'project'));
    }

    // 2. Remote: install packages
    if (config.install?.length) {
        const cacheDir = config.cacheDir ?? join(homedir(), `.${appName}`, 'agents', 'registry');
        const registryUrl = config.remote ?? 'https://registry.backendkit.dev/agents';
        const registry = new RemoteAgentRegistry(registryUrl, cacheDir);

        const results = await Promise.allSettled(
            config.install.map(name => registry.installPackage(name)),
        );

        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result.status === 'fulfilled' && result.value) {
                add([result.value]);
            } else if (result.status === 'rejected') {
                console.warn(
                    `[AgentDiscovery] Failed to install "${config.install[i]}": ${(result.reason as Error).message}`,
                );
            }
        }
    }

    return agents;
}
