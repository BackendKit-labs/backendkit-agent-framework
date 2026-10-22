import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import type { SandboxMode, SandboxNetwork } from '@backendkit-labs/agent-core';
import { killProcessTree, runProcess } from '../process';
import type { BackendExecRequest, SandboxBackend } from './types';

export interface DockerBackendOptions {
    /** Docker CLI to call. Default `docker`. */
    bin?: string;
    /** Image the command runs in; it must ship the tools the command needs. Default `node:22`. */
    image?: string;
    /** Memory limit. Default `2g`. */
    memory?: string;
    /** Process limit. Default 512. */
    pidsLimit?: number;
    /** Replace the availability probe (tests, or an already known state). */
    probe?: () => Promise<boolean>;
    /** How long a negative probe result is trusted before asking the daemon again. Default 5 s. */
    negativeTtlMs?: number;
}

function defaultProbe(bin: string): Promise<boolean> {
    return new Promise<boolean>(resolve => {
        let done = false;
        const finish = (ok: boolean) => { if (!done) { done = true; clearTimeout(timer); resolve(ok); } };
        let proc: ChildProcess;
        try { proc = spawn(bin, ['version', '--format', '{{.Server.Version}}'], { stdio: 'ignore' }); }
        catch { resolve(false); return; }
        const timer = setTimeout(() => { try { proc.kill(); } catch { /* gone */ } finish(false); }, 4000);
        proc.on('error', () => finish(false));
        proc.on('close', code => finish(code === 0));
    });
}

/**
 * Arguments of `docker run` for one confined command: all capabilities dropped, no new privileges,
 * memory and process limits, only the workspace mounted (read-only in `read-only` mode).
 */
export function buildDockerArgs(
    name: string,
    req: Pick<BackendExecRequest, 'command' | 'cwd' | 'workspace' | 'mode' | 'network'>,
    opts: { image: string; memory: string; pidsLimit: number },
): string[] {
    const rel = path.relative(req.workspace, req.cwd).split(path.sep).join('/');
    const readOnly = req.mode === 'read-only';
    return [
        'run', '--rm', '--name', name,
        '--network', req.network === 'none' ? 'none' : 'bridge',
        '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges',
        '--memory', opts.memory,
        '--pids-limit', String(opts.pidsLimit),
        ...(readOnly ? ['--read-only', '--tmpfs', '/tmp'] : []),
        '-v', `${req.workspace}:/workspace${readOnly ? ':ro' : ''}`,
        '-w', rel ? `/workspace/${rel}` : '/workspace',
        opts.image,
        'sh', '-c', req.command,
    ];
}

/**
 * Container confinement. `read-only` mounts the workspace read-only (and the container root); `workspace-write`
 * writes only inside the workspace; the network is `none` unless the policy allows it. It never claims
 * `danger-full-access` (a container is not full access), and when the daemon does not answer the service
 * reports SANDBOX_UNAVAILABLE instead of running on the host.
 */
export class DockerBackend implements SandboxBackend {
    readonly name = 'docker';
    private readonly bin: string;
    private readonly image: string;
    private readonly memory: string;
    private readonly pidsLimit: number;
    private readonly probe: () => Promise<boolean>;
    private readonly negativeTtlMs: number;
    private cached?: { ok: boolean; at: number };

    constructor(opts: DockerBackendOptions = {}) {
        this.bin = opts.bin ?? 'docker';
        this.image = opts.image ?? 'node:22';
        this.memory = opts.memory ?? '2g';
        this.pidsLimit = opts.pidsLimit ?? 512;
        this.probe = opts.probe ?? (() => defaultProbe(this.bin));
        this.negativeTtlMs = opts.negativeTtlMs ?? 5000;
    }

    supports(mode: SandboxMode, _network: SandboxNetwork): boolean {
        return mode === 'read-only' || mode === 'workspace-write';
    }

    async available(): Promise<boolean> {
        const now = Date.now();
        if (this.cached && (this.cached.ok || now - this.cached.at < this.negativeTtlMs)) return this.cached.ok;
        const ok = await this.probe().catch(() => false);
        this.cached = { ok, at: now };
        return ok;
    }

    unavailableReason(): string {
        return `the docker daemon is not reachable ("${this.bin} version" failed)`;
    }

    exec(req: BackendExecRequest) {
        const name = `bk-run-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const proc = spawn(this.bin, buildDockerArgs(name, req, { image: this.image, memory: this.memory, pidsLimit: this.pidsLimit }));
        return runProcess(proc, {
            timeoutMs: req.timeoutMs, signal: req.signal, onOutput: req.onOutput,
            kill: (p) => {
                spawn(this.bin, ['kill', name], { stdio: 'ignore' }).on('error', () => undefined);
                killProcessTree(p);
            },
        });
    }
}
