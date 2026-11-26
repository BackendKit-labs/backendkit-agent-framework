import type { SandboxRunner } from '@backendkit-labs/agent-core';
import {
    createSandboxPolicy, createSandboxService, DockerBackend, NoneBackend,
    type DockerBackendOptions, type PermissionPreset, type SandboxPolicyConfig,
} from '@backendkit-labs/agent-sandbox';

/**
 * Tools of the coding set that write to the workspace. `read-only` refuses them (they declare `readOnly: false`; the list is a
 * reinforcement). `run_command` is not listed: it is confined by the backend (a read-only mount), not refused by name.
 */
export const CODING_WRITE_TOOLS: readonly string[] = ['write_file', 'edit_file'];

/**
 * Tools of the coding set that write only the agent's own store (its memory, outside the workspace): they keep working in
 * `read-only` and never ask. Named on purpose: the sandbox refuses every other tool that does not declare `readOnly: true`.
 */
export const CODING_OWN_STATE_TOOLS: readonly string[] = ['save_context', 'save_audit', 'update_session', 'save_learning', 'save_user_preference'];

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
            ownStateTools: [...CODING_OWN_STATE_TOOLS],
            commandTools: ['run_command'],
            ...(config.preset ? { preset: config.preset } : {}),
            ...config.policy,
        }),
        backends,
        ...(config.auditLog ? { auditLog: config.auditLog } : {}),
    });
}
