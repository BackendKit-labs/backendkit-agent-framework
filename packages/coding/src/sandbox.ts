import type { SandboxRunner } from '@backendkit-labs/agent-core';
import {
    createSandboxPolicy, createSandboxService, DockerBackend, NoneBackend,
    type DockerBackendOptions, type PermissionPreset, type SandboxPolicyConfig,
} from '@backendkit-labs/agent-sandbox';

/**
 * Tools of the coding set that write to the workspace. `read-only` refuses them. The memory tools
 * (`save_context`, `save_audit`, `update_session`, …) write the agent's own store outside the workspace and keep working.
 * `run_command` is not listed: it is confined by the backend (a read-only mount), not refused by name.
 */
export const CODING_WRITE_TOOLS: readonly string[] = ['write_file', 'edit_file'];

export interface CodingSandboxOptions {
    /** Starting point for mode and approval. Default `ask`. */
    preset?: PermissionPreset;
    /** The rest of the policy (rules per agent/tool, network, roots, env). Merged over the defaults below. */
    policy?: SandboxPolicyConfig;
    /** Backends to try, in order. Default `['docker', 'none']`: a container when it can enforce the mode, the host only for `full`. */
    backends?: Array<'docker' | 'none'>;
    docker?: DockerBackendOptions;
    /** Append every sandbox decision to this NDJSON file. */
    auditLog?: string;
}

/** A ready-made runner, or a config to build one. */
export type CodingSandboxConfig = SandboxRunner | CodingSandboxOptions;

function isRunner(x: CodingSandboxConfig): x is SandboxRunner {
    return typeof (x as SandboxRunner).run === 'function';
}

/** Builds the sandbox `createCodingEngine` hands to the engine. */
export function buildCodingSandbox(config: CodingSandboxConfig): SandboxRunner {
    if (isRunner(config)) return config;
    const backends = (config.backends ?? ['docker', 'none']).map(b => (b === 'docker' ? new DockerBackend(config.docker) : new NoneBackend()));
    return createSandboxService({
        policy: createSandboxPolicy({
            writeTools: [...CODING_WRITE_TOOLS],
            commandTools: ['run_command'],
            ...(config.preset ? { preset: config.preset } : {}),
            ...config.policy,
        }),
        backends,
        ...(config.auditLog ? { auditLog: config.auditLog } : {}),
    });
}
