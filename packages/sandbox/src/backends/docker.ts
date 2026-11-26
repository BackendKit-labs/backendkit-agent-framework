import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import type { SandboxMode, SandboxNetwork } from '@backendkit-labs/agent-core';
import { killProcessTree, runProcess } from '../process';
import type { BackendExecRequest, SandboxBackend } from './types';

/**
 * `node:22` pinned by the digest of its multi-platform index (linux/amd64 and arm64 both resolve from it). Bump it deliberately:
 * `docker buildx imagetools inspect node:22` shows the current one.
 */
export const DEFAULT_DOCKER_IMAGE = 'node:22@sha256:e13726ca604184d7a91fcacab1fc09eefd642dc28e79ac34e85540dd93b78cfb';

/** Where a command run as a user with no home directory (a bare uid) keeps its caches: npm and others write under HOME. */
const CONTAINER_HOME = '/tmp';

/** No uid to borrow on Windows: a fixed unprivileged one. */
const DEFAULT_WINDOWS_USER = '1000:1000';

export interface DockerBackendOptions {
    /** Docker CLI to call. Default `docker`. */
    bin?: string;
    /**
     * Image the command runs in; it must ship the tools the command needs. Default `DEFAULT_DOCKER_IMAGE`: `node:22` pinned by
     * digest, so a tag that moves cannot change what the sandbox runs. A tag you pass is used as you give it.
     */
    image?: string;
    /** Memory limit. Default `2g`. */
    memory?: string;
    /** Process limit. Default 512. */
    pidsLimit?: number;
    /**
     * User the command runs as inside the container (`uid:gid`). Default on POSIX: the uid and gid of this process,
     * so the command is not root and the files it creates belong to you. With all capabilities dropped, a root
     * container cannot touch host files owned by another user, which is the usual case on Linux. On Windows there is
     * no uid: the default is `1000:1000` (not root, and it needs no entry in the image's user database). Pass `false`
     * to leave the image's default user (root in most images).
     */
    user?: string | false;
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
 * memory and process limits, only the workspace and the policy's extra roots mounted (read-only in `read-only` mode).
 * The working directory is the `cwd` inside the mount that holds it. A `cwd` in none of them throws: the command would
 * otherwise run in an empty directory docker makes up inside the container.
 */
export function buildDockerArgs(
    name: string,
    req: Pick<BackendExecRequest, 'command' | 'cwd' | 'workspace' | 'roots' | 'mode' | 'network'>,
    opts: { image: string; memory: string; pidsLimit: number; user?: string },
): string[] {
    const readOnly = req.mode === 'read-only';
    const mounts = [{ host: req.workspace, at: '/workspace' }];
    for (const root of req.roots ?? []) {
        if (!mounts.some(m => path.resolve(m.host) === path.resolve(root))) mounts.push({ host: root, at: `/roots/${mounts.length - 1}` });
    }
    const relTo = (host: string): string | undefined => {
        const rel = path.relative(host, req.cwd);
        const outside = rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
        return outside ? undefined : rel.split(path.sep).join('/');
    };
    const holder = mounts.find(m => relTo(m.host) !== undefined);
    if (!holder) throw new Error(`the working directory "${req.cwd}" is in none of the mounted directories (the workspace and the policy roots)`);
    const rel = relTo(holder.host)!;
    return [
        'run', '--rm', '--name', name,
        '--network', req.network === 'none' ? 'none' : 'bridge',
        '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges',
        '--memory', opts.memory,
        '--pids-limit', String(opts.pidsLimit),
        ...(opts.user ? ['--user', opts.user, '-e', `HOME=${CONTAINER_HOME}`] : []),
        ...(readOnly ? ['--read-only', '--tmpfs', '/tmp'] : []),
        ...mounts.flatMap(m => ['-v', `${m.host}:${m.at}${readOnly ? ':ro' : ''}`]),
        '-w', rel ? `${holder.at}/${rel}` : holder.at,
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
    private readonly user: string | undefined;
    private readonly probe: () => Promise<boolean>;
    private readonly negativeTtlMs: number;
    private cached?: { ok: boolean; at: number };

    constructor(opts: DockerBackendOptions = {}) {
        this.bin = opts.bin ?? 'docker';
        this.image = opts.image ?? DEFAULT_DOCKER_IMAGE;
        this.memory = opts.memory ?? '2g';
        this.pidsLimit = opts.pidsLimit ?? 512;
        this.user = opts.user === false ? undefined
            : opts.user ?? (typeof process.getuid === 'function' && typeof process.getgid === 'function' ? `${process.getuid()}:${process.getgid()}` : DEFAULT_WINDOWS_USER);
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
        const proc = spawn(this.bin, buildDockerArgs(name, req, { image: this.image, memory: this.memory, pidsLimit: this.pidsLimit, user: this.user }));
        return runProcess(proc, {
            timeoutMs: req.timeoutMs, signal: req.signal, onOutput: req.onOutput,
            kill: (p) => {
                spawn(this.bin, ['kill', name], { stdio: 'ignore' }).on('error', () => undefined);
                killProcessTree(p);
            },
        });
    }
}
