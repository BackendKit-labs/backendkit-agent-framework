import type { AgentProfile } from '@backendkit-labs/agent-core';

// ── Package format ────────────────────────────────────────────────────────────

/** Raw structure of an agent.yaml / agent.json file. */
export type AgentPackageFile = Omit<AgentProfile, 'source'> & {
    source?: AgentProfile['source'];
};

// ── Remote registry ───────────────────────────────────────────────────────────

export interface RemotePackageListing {
    name: string;
    version: string;
    description: string;
    /** URL to download the agent.yaml for this package. */
    downloadUrl: string;
    /** Hex SHA-256 of the agent.yaml. When present the download is checked against it and refused if it differs. */
    sha256?: string;
}

export interface RemoteRegistryIndex {
    version: string;
    agents: RemotePackageListing[];
}

// ── Discovery config ──────────────────────────────────────────────────────────

export interface AgentDiscoveryConfig {
    /**
     * Application name used to locate global agent directories.
     * Agents are looked up in ~/.{appName}/agents/.
     * Defaults to 'bk-agent'.
     */
    appName?: string;
    /**
     * Load agents from the global (~/.{appName}/agents/) and
     * project-local ({workingDir}/.{appName}/agents/) directories.
     * Default: true.
     */
    local?: boolean;
    /** Working directory for project-local agent loading. Defaults to process.cwd(). */
    workingDir?: string;
    /**
     * Whether the project layer (`{workingDir}/.{appName}/agents`) may load. Default: asked of the workspace trust
     * (ADR-0006): true only for a project the user trusted or with BK_TRUST_PROJECT=1. The agents of a repository
     * are the repository's own content, so they load only on the user's say-so. Pass it when the host already decided.
     */
    trusted?: boolean;
    /** Remote registry URL (e.g. 'https://registry.backendkit.dev/agents'). */
    remote?: string;
    /** Package names to install/cache from the remote registry. */
    install?: string[];
    /**
     * Refuse a package whose listing in the registry index has no `sha256`. Default false: without a hash the file is accepted
     * with a warning, because nothing proves it is the one the registry meant to publish.
     */
    requireIntegrity?: boolean;
    /**
     * Override the local cache directory for downloaded packages.
     * Defaults to ~/.{appName}/agents/registry/.
     */
    cacheDir?: string;
}
