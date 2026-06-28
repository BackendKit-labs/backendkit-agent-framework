import { Injectable, Logger } from '@nestjs/common';
import { Writable } from 'node:stream';
import type Docker from 'dockerode';
import type {
  AgentSpec,
  ExecResult,
  LogOptions,
  RuntimeAdapter,
  RuntimeCapability,
  RuntimeDaemonStatus,
  RuntimeHandle,
  RuntimeStatus,
} from '../runtime.spi';
import {
  buildCreateOptions,
  createDockerClient,
  demuxDockerLogs,
  dockerHostLabel,
  mapDockerPhase,
  now,
} from '../runtime.helpers';

/** Real Docker runtime backed by dockerode. */
@Injectable()
export class DockerRuntimeAdapter implements RuntimeAdapter {
  readonly kind = 'docker' as const;
  readonly availability = 'available' as const;
  private readonly logger = new Logger(DockerRuntimeAdapter.name);
  private readonly docker: Docker = createDockerClient();

  capabilities(): RuntimeCapability[] {
    return [
      { name: 'deploy', status: 'available' },
      { name: 'stop', status: 'available' },
      { name: 'remove', status: 'available' },
      { name: 'logs', status: 'available' },
      { name: 'exec', status: 'available' },
      { name: 'stream-logs', status: 'partial', reason: 'SSE follow llega en un PR posterior' },
    ];
  }

  async ping(): Promise<RuntimeDaemonStatus> {
    try {
      await this.docker.ping();
      const version = await this.docker.version();
      return {
        kind: this.kind,
        registered: true,
        reachable: 'reachable',
        endpoint: dockerHostLabel(),
        version: version.Version,
        checkedAt: now(),
        error: null,
      };
    } catch (err) {
      return {
        kind: this.kind,
        registered: true,
        reachable: 'unavailable',
        endpoint: dockerHostLabel(),
        checkedAt: now(),
        error: (err as Error).message,
      };
    }
  }

  async deploy(spec: AgentSpec): Promise<RuntimeHandle> {
    await this.ensureImage(spec.image);
    // Idempotency: drop a previous container for the same agent before recreating.
    await this.removeByAgentId(spec.agentId);

    const container = await this.docker.createContainer(buildCreateOptions(spec));
    await container.start();
    this.logger.log(`Deployed agent ${spec.agentId} -> container ${container.id.slice(0, 12)}`);
    return {
      id: container.id,
      kind: this.kind,
      agentId: spec.agentId,
      name: spec.name,
      phase: 'running',
      createdAt: now(),
    };
  }

  async stop(handleId: string): Promise<void> {
    try {
      await this.docker.getContainer(handleId).stop();
    } catch (err) {
      // 304 = already stopped; treat as success.
      if ((err as { statusCode?: number }).statusCode !== 304) throw err;
    }
  }

  async remove(handleId: string): Promise<void> {
    await this.docker.getContainer(handleId).remove({ force: true });
  }

  async status(handleId: string): Promise<RuntimeStatus> {
    const info = await this.docker.getContainer(handleId).inspect();
    const state = info.State;
    return {
      phase: mapDockerPhase(state.Status, state.ExitCode),
      message: state.Error || undefined,
      startedAt: state.StartedAt ?? null,
      finishedAt: state.FinishedAt ?? null,
      exitCode: state.ExitCode ?? null,
    };
  }

  async logs(handleId: string, opts?: LogOptions): Promise<string> {
    const buf = (await this.docker.getContainer(handleId).logs({
      stdout: true,
      stderr: true,
      tail: opts?.tail ?? 200,
      since: opts?.since ? Math.floor(new Date(opts.since).getTime() / 1000) : undefined,
      follow: false,
    })) as unknown as Buffer;
    return demuxDockerLogs(buf);
  }

  async exec(handleId: string, command: string): Promise<ExecResult> {
    const exec = await this.docker.getContainer(handleId).exec({
      Cmd: ['sh', '-c', command],
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await exec.start({});

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const sink = (chunks: Buffer[]) =>
        new Writable({
          write(chunk, _enc, cb) {
            chunks.push(Buffer.from(chunk));
            cb();
          },
        });
      this.docker.modem.demuxStream(stream, sink(stdoutChunks), sink(stderrChunks));
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    const inspect = await exec.inspect();
    return {
      exitCode: inspect.ExitCode ?? 0,
      stdout: Buffer.concat(stdoutChunks).toString('utf8'),
      stderr: Buffer.concat(stderrChunks).toString('utf8'),
    };
  }

  async list(): Promise<RuntimeHandle[]> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: { label: ['agent-cloud.managed=true'] },
    });
    return containers.map((c) => ({
      id: c.Id,
      kind: this.kind,
      agentId: c.Labels['agent-cloud.agentId'] ?? '',
      name: (c.Names[0] ?? '').replace(/^\//, ''),
      phase: mapDockerPhase(c.State),
      createdAt: new Date(c.Created * 1000).toISOString(),
    }));
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async ensureImage(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
      return;
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode !== 404) throw err;
    }
    this.logger.log(`Pulling image ${image}...`);
    const stream = await this.docker.pull(image);
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(stream, (e) => (e ? reject(e) : resolve()));
    });
  }

  private async removeByAgentId(agentId: string): Promise<void> {
    const existing = await this.docker.listContainers({
      all: true,
      filters: { label: [`agent-cloud.agentId=${agentId}`] },
    });
    for (const c of existing) {
      await this.docker.getContainer(c.Id).remove({ force: true }).catch(() => undefined);
    }
  }
}
