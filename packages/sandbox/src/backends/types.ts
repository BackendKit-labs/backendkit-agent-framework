import type { SandboxExecResult, SandboxMode, SandboxNetwork } from '@backendkit-labs/agent-core';

export interface BackendExecRequest {
    /** Portable command line. */
    command: string;
    /** Command line adjusted for the host shell, for backends that run on the host. */
    hostCommand?: string;
    cwd: string;
    /** Directory exposed to the command (mounted by container backends). */
    workspace: string;
    mode: SandboxMode;
    network: SandboxNetwork;
    /** Environment for backends that run on the host (already scrubbed). */
    env: Record<string, string>;
    timeoutMs?: number;
    signal?: AbortSignal;
    onOutput?: (chunk: string) => void;
}

/** Something that can run a command with a given confinement. */
export interface SandboxBackend {
    readonly name: string;
    /**
     * Can this backend ENFORCE `mode` with `network`? Honest answers only: checking that a path is inside
     * the workspace is not confinement, so a host backend must not claim `workspace-write`.
     */
    supports(mode: SandboxMode, network: SandboxNetwork): boolean;
    /** Is the backend usable on this host right now (e.g. the docker daemon answers)? */
    available(): Promise<boolean>;
    /** Why `available()` is false, for the error shown to the operator. */
    unavailableReason?(): string;
    exec(req: BackendExecRequest): Promise<SandboxExecResult>;
}
