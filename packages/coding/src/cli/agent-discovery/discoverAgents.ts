import { join } from 'path';
import { isProjectTrusted } from '../trust/workspace-trust';
import { getFrameworkDir } from '@backendkit-labs/agent-core';
import type { AgentProfile } from '@backendkit-labs/agent-core';
import type { AgentDiscoveryConfig } from './types';
import { loadAgentsFromDir, globalAgentsDir, projectAgentsDir, listAgentEntries } from './AgentPackageLoader';
import { RemoteAgentRegistry } from './RemoteAgentRegistry';

const DEFAULT_APP_NAME = 'bk-agent';

/**
 * Discover agents from local directories and/or a remote registry.
 *
 * Local layout (appName = 'bk-agent'):
 *   ~/.bk-agent/agents/                    ← global agents (shared across projects)
 *   {workingDir}/.bk-agent/agents/         ← project-local agents (git-tracked); only in a TRUSTED project
 *
 * Remote:
 *   Fetch the registry index, download requested packages, cache locally.
 *   Re-running is fast — cached packages are reused until deleted.
 *
 * Deduplication: if the same agent id appears in multiple sources, the first occurrence wins:
 * project → global → registry → static agents. The project overrides the global one, as in coding's AgentLoader.
 *
 * Format: this loader reads `*.yaml|yml|json` and `<name>/agent.yaml` (a full AgentProfile); coding's AgentLoader
 * reads `*.json` (+ `.md` prompt) from the same directories. They are two formats on purpose, not one divergent copy.
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

    // 1. Local: the project first (it overrides), then the global ones
    if (config.local !== false) {
        const projectDir = projectAgentsDir(cwd, appName);
        const trusted = config.trusted ?? isProjectTrusted(appName, cwd).trusted;
        if (trusted) {
            add(loadAgentsFromDir(projectDir, 'project'));
        } else {
            const left = listAgentEntries(projectDir);
            if (left.length > 0) {
                console.warn(
                    `[AgentDiscovery] This project is not trusted, so its own ${left.length} agent(s) (${left.join(', ')}) in ${projectDir} were NOT loaded. ` +
                    `Trust it with /trust add (or BK_TRUST_PROJECT=1) only if you trust whoever wrote that repository.`,
                );
            }
        }
        add(loadAgentsFromDir(globalAgentsDir(appName), 'global'));
    }

    // 2. Remote: install packages
    if (config.install?.length) {
        const cacheDir = config.cacheDir ?? join(getFrameworkDir(appName), 'agents', 'registry');
        const registryUrl = config.remote ?? 'https://registry.backendkit.dev/agents';
        const registry = new RemoteAgentRegistry(registryUrl, cacheDir, { requireIntegrity: config.requireIntegrity });

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
