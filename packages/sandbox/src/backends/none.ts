import { spawn } from 'child_process';
import type { SandboxMode, SandboxNetwork } from '@backendkit-labs/agent-core';
import { runProcess } from '../process';
import type { BackendExecRequest, SandboxBackend } from './types';

/**
 * Runs on the host with no confinement. It therefore claims exactly one thing: `danger-full-access`
 * with the network open. Anything stricter makes the service look for another backend, or fail.
 */
export class NoneBackend implements SandboxBackend {
    readonly name = 'none';

    supports(mode: SandboxMode, network: SandboxNetwork): boolean {
        return mode === 'danger-full-access' && network === 'allow';
    }

    async available(): Promise<boolean> { return true; }

    exec(req: BackendExecRequest) {
        const proc = spawn(req.hostCommand ?? req.command, {
            shell: true,
            cwd: req.cwd,
            env: req.env,
            // Own process group on POSIX, so the whole tree can be signalled.
            detached: process.platform !== 'win32',
        });
        return runProcess(proc, { timeoutMs: req.timeoutMs, signal: req.signal, onOutput: req.onOutput });
    }
}
