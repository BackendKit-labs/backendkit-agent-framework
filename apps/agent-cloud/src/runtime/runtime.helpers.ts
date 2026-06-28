import Docker from 'dockerode';
import type { ContainerCreateOptions } from 'dockerode';
import type { AgentSpec, RuntimePhase } from './runtime.spi';

/**
 * Build a Dockerode client from DOCKER_HOST. When unset, Dockerode auto-selects
 * the platform default (named pipe on Windows, unix socket elsewhere).
 *
 * Supported DOCKER_HOST forms:
 *   unix:///var/run/docker.sock        -> socketPath
 *   npipe:////./pipe/docker_engine     -> socketPath (Windows)
 *   tcp://host:port / http://host:port -> host + port
 */
export function createDockerClient(dockerHost = process.env.DOCKER_HOST): Docker {
  if (!dockerHost) return new Docker();

  if (dockerHost.startsWith('unix://')) {
    return new Docker({ socketPath: dockerHost.replace('unix://', '') });
  }
  if (dockerHost.startsWith('npipe://')) {
    return new Docker({ socketPath: dockerHost.replace('npipe://', '') });
  }
  const url = new URL(dockerHost);
  return new Docker({ host: url.hostname, port: Number(url.port) || 2375 });
}

export function dockerHostLabel(dockerHost = process.env.DOCKER_HOST): string {
  if (dockerHost) return dockerHost;
  return process.platform === 'win32'
    ? 'npipe:////./pipe/docker_engine'
    : 'unix:///var/run/docker.sock';
}

export function now(): string {
  return new Date().toISOString();
}

/** Container names must match [a-zA-Z0-9][a-zA-Z0-9_.-]+ */
export function containerName(agentId: string): string {
  return `agent-${agentId}`.replace(/[^a-zA-Z0-9_.-]/g, '-');
}

export function toEnvArray(env?: Record<string, string>): string[] {
  return Object.entries(env ?? {}).map(([k, v]) => `${k}=${v}`);
}

/** Map a Docker State.Status (+ exit code) to a runtime-agnostic phase. */
export function mapDockerPhase(status: string, exitCode?: number): RuntimePhase {
  switch (status) {
    case 'running':
      return 'running';
    case 'created':
    case 'restarting':
      return 'pending';
    case 'paused':
      return 'unknown';
    case 'exited':
    case 'dead':
      return exitCode && exitCode !== 0 ? 'failed' : 'stopped';
    default:
      return 'unknown';
  }
}

export function buildCreateOptions(spec: AgentSpec): ContainerCreateOptions {
  const exposed: Record<string, Record<string, never>> = {};
  const portBindings: Record<string, Array<{ HostPort: string }>> = {};
  for (const p of spec.ports ?? []) {
    const key = `${p.container}/tcp`;
    exposed[key] = {};
    if (p.host) portBindings[key] = [{ HostPort: String(p.host) }];
  }

  return {
    name: containerName(spec.agentId),
    Image: spec.image,
    Env: toEnvArray(spec.env),
    Cmd: spec.command,
    Labels: {
      'agent-cloud.managed': 'true',
      'agent-cloud.agentId': spec.agentId,
      ...spec.labels,
    },
    ExposedPorts: Object.keys(exposed).length ? exposed : undefined,
    HostConfig: {
      PortBindings: Object.keys(portBindings).length ? portBindings : undefined,
      Memory: spec.resources?.memoryMb ? spec.resources.memoryMb * 1024 * 1024 : undefined,
      NanoCpus: spec.resources?.cpus ? Math.round(spec.resources.cpus * 1e9) : undefined,
      Binds: (spec.volumes ?? []).map(
        (v) => `${v.source}:${v.target}${v.readOnly ? ':ro' : ''}`,
      ),
    },
  };
}

/**
 * Demultiplex a non-TTY Docker log buffer (8-byte frame headers) into plain text.
 * Frame: [streamType, 0,0,0, size(4, big-endian)][payload].
 */
export function demuxDockerLogs(buffer: Buffer): string {
  let out = '';
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > buffer.length) break;
    out += buffer.toString('utf8', start, end);
    offset = end;
  }
  // Fallback: buffer wasn't multiplexed (e.g. TTY containers).
  return out || buffer.toString('utf8');
}
