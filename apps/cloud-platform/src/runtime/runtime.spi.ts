/**
 * RuntimeSPI — runtime-agnostic agent lifecycle contract.
 *
 * The DirectorService talks only to this contract; concrete runtimes (Docker,
 * k8s, local process) implement RuntimeAdapter and are resolved through the
 * RuntimeRegistry. See .specs/design-phase1-runtime-spi.md.
 */

export type RuntimeKind = 'docker' | 'k8s' | 'process';
export type RuntimeAvailability = 'available' | 'coming_soon';
export type CapabilityStatus = 'available' | 'partial' | 'blocked' | 'coming_soon';
export type RuntimePhase = 'pending' | 'running' | 'stopped' | 'failed' | 'unknown';

/** What the director wants deployed, independent of the runtime. */
export interface AgentSpec {
  agentId: string;
  name: string;
  image: string;
  env?: Record<string, string>;
  command?: string[];
  labels?: Record<string, string>;
  ports?: Array<{ container: number; host?: number }>;
  volumes?: Array<{ source: string; target: string; readOnly?: boolean }>;
  resources?: { cpus?: number; memoryMb?: number };
}

/** Opaque reference to a deployed instance (container id, pod name, pid). */
export interface RuntimeHandle {
  id: string;
  kind: RuntimeKind;
  agentId: string;
  name: string;
  phase: RuntimePhase;
  createdAt: string;
}

export interface RuntimeStatus {
  phase: RuntimePhase;
  message?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  exitCode?: number | null;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface LogOptions {
  tail?: number;
  since?: string;
  follow?: boolean;
}

/** Capability declared by an adapter — drives the UI (what works, and why not). */
export interface RuntimeCapability {
  name: 'deploy' | 'stop' | 'remove' | 'logs' | 'exec' | 'stream-logs';
  status: CapabilityStatus;
  reason?: string;
}

/** Daemon-level health (analogous to floci's CloudStatus). */
export interface RuntimeDaemonStatus {
  kind: RuntimeKind;
  registered: boolean;
  reachable: 'reachable' | 'unavailable' | 'coming_soon';
  endpoint: string | null;
  version?: string | null;
  checkedAt: string;
  error: string | null;
}

export interface RuntimeAdapter {
  readonly kind: RuntimeKind;
  readonly availability: RuntimeAvailability;
  capabilities(): RuntimeCapability[];
  ping(): Promise<RuntimeDaemonStatus>;
  deploy(spec: AgentSpec): Promise<RuntimeHandle>;
  stop(handleId: string): Promise<void>;
  remove(handleId: string): Promise<void>;
  status(handleId: string): Promise<RuntimeStatus>;
  logs(handleId: string, opts?: LogOptions): Promise<string>;
  exec(handleId: string, command: string): Promise<ExecResult>;
  list(): Promise<RuntimeHandle[]>;
  /** Optional live streaming (SSE). If absent, the UI falls back to logs() polling. */
  streamLogs?(handleId: string, opts?: LogOptions): AsyncIterable<string>;
}
