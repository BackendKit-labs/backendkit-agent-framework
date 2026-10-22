import type { SandboxRunner } from '@backendkit-labs/agent-core';
import { createSandboxPolicy, createSandboxService, DockerBackend, NoneBackend } from '@backendkit-labs/agent-sandbox';

/**
 * What `run_command` runs through when the engine has no sandbox configured: the old
 * `BK_RUN_COMMAND_SANDBOX` switch, translated to the equivalent policy. Deprecated: configure `sandbox` on the
 * engine instead.
 *
 * - unset or `none`: the host, no confinement, the whole environment (exactly as before).
 * - `docker`: the container backend with the workspace mounted read-write and the network closed. The
 *   availability probe is off on purpose: the legacy behaviour is to try `docker run` and report the failure,
 *   and it can never fall back to the host because the host backend is not in this policy.
 *   `BK_SANDBOX_NETWORK` other than `none` now means "open" (bridge). The command runs as the host user on POSIX.
 */
export type LegacySandbox = { runner: SandboxRunner } | { error: string };

const cache = new Map<string, SandboxRunner>();

export function legacySandbox(env: NodeJS.ProcessEnv = process.env): LegacySandbox {
    const mode = (env.BK_RUN_COMMAND_SANDBOX ?? 'none').toLowerCase();
    if (mode !== 'none' && mode !== 'docker') {
        return { error: `Error: invalid BK_RUN_COMMAND_SANDBOX "${mode}" (expected "none" or "docker")` };
    }

    const network = (env.BK_SANDBOX_NETWORK ?? 'none') === 'none' ? 'none' : 'allow';
    const key = mode === 'none' ? 'none' : `docker|${network}|${env.BK_SANDBOX_IMAGE ?? ''}|${env.BK_SANDBOX_MEMORY ?? ''}`;
    let runner = cache.get(key);
    if (!runner) {
        runner = mode === 'none'
            ? createSandboxService({ policy: createSandboxPolicy({ preset: 'full' }), backends: [new NoneBackend()], scrubEnvironment: false })
            : createSandboxService({
                policy: createSandboxPolicy({ preset: 'ask', approval: 'none', network }),
                backends: [new DockerBackend({
                    ...(env.BK_SANDBOX_IMAGE ? { image: env.BK_SANDBOX_IMAGE } : {}),
                    ...(env.BK_SANDBOX_MEMORY ? { memory: env.BK_SANDBOX_MEMORY } : {}),
                    probe: async () => true,
                })],
            });
        cache.set(key, runner);
    }
    return { runner };
}
