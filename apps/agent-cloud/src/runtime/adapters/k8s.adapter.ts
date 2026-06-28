import { Injectable, Logger } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import type {
  AgentSpec,
  ExecResult,
  LogOptions,
  RuntimeAdapter,
  RuntimeCapability,
  RuntimeDaemonStatus,
  RuntimeHandle,
  RuntimeKind,
  RuntimePhase,
  RuntimeStatus,
} from '../runtime.spi';

const MANAGED_LABEL = 'agent-cloud.managed';
const AGENT_ID_LABEL = 'agent-cloud.agentId';

const DEFAULT_NS = process.env.K8S_NAMESPACE ?? 'agent-cloud';

function deploymentName(agentId: string): string {
  return `agent-${agentId}`.replace(/[^a-z0-9-]/g, '-').toLowerCase();
}

function encodeHandle(namespace: string, name: string): string {
  return `${namespace}/${name}`;
}

function decodeHandle(handleId: string): { namespace: string; name: string } {
  const idx = handleId.indexOf('/');
  if (idx === -1) return { namespace: DEFAULT_NS, name: handleId };
  return { namespace: handleId.slice(0, idx), name: handleId.slice(idx + 1) };
}

function mapDeploymentPhase(dep: k8s.V1Deployment): RuntimePhase {
  const desired = dep.spec?.replicas ?? 1;
  if (desired === 0) return 'stopped';
  const ready = dep.status?.readyReplicas ?? 0;
  const available = dep.status?.availableReplicas ?? 0;
  if (ready > 0 && available > 0) return 'running';
  const conditions = dep.status?.conditions ?? [];
  if (conditions.some((c) => c.type === 'Available' && c.status === 'False')) return 'failed';
  return 'pending';
}

function buildKc(): k8s.KubeConfig {
  const kc = new k8s.KubeConfig();
  if (process.env.K8S_KUBECONFIG) {
    kc.loadFromFile(process.env.K8S_KUBECONFIG);
  } else if (process.env.KUBERNETES_SERVICE_HOST) {
    kc.loadFromCluster();
  } else {
    kc.loadFromDefault();
  }
  return kc;
}

@Injectable()
export class K8sRuntimeAdapter implements RuntimeAdapter {
  readonly kind: RuntimeKind = 'k8s';
  readonly availability = 'available' as const;

  private readonly logger = new Logger(K8sRuntimeAdapter.name);
  private readonly kc = buildKc();
  private readonly apps = this.kc.makeApiClient(k8s.AppsV1Api);
  private readonly core = this.kc.makeApiClient(k8s.CoreV1Api);

  capabilities(): RuntimeCapability[] {
    return [
      { name: 'deploy',      status: 'available' },
      { name: 'stop',        status: 'available', reason: 'Scales replicas to 0' },
      { name: 'remove',      status: 'available' },
      { name: 'logs',        status: 'available' },
      { name: 'exec',        status: 'partial',   reason: 'Single-shot exec; no interactive TTY' },
      { name: 'stream-logs', status: 'coming_soon' },
    ];
  }

  async ping(): Promise<RuntimeDaemonStatus> {
    const checkedAt = new Date().toISOString();
    const endpoint = this.kc.getCurrentCluster()?.server ?? null;
    try {
      await this.core.listNamespace({ limit: 1 });
      return { kind: this.kind, registered: true, reachable: 'reachable', endpoint, checkedAt, error: null };
    } catch (err) {
      return { kind: this.kind, registered: true, reachable: 'unavailable', endpoint, checkedAt, error: (err as Error).message };
    }
  }

  async deploy(spec: AgentSpec): Promise<RuntimeHandle> {
    await this.ensureNamespace(DEFAULT_NS);

    const name   = deploymentName(spec.agentId);
    const labels: Record<string, string> = {
      [MANAGED_LABEL]: 'true',
      [AGENT_ID_LABEL]: spec.agentId,
      app: name,
      ...spec.labels,
    };

    const envVars: k8s.V1EnvVar[] = Object.entries(spec.env ?? {}).map(([n, value]) => ({ name: n, value }));
    const ports: k8s.V1ContainerPort[] = (spec.ports ?? []).map((p) => ({ containerPort: p.container, protocol: 'TCP' }));
    const volumes: k8s.V1Volume[] = (spec.volumes ?? []).map((v, i) => ({ name: `vol-${i}`, hostPath: { path: v.source } }));
    const volumeMounts: k8s.V1VolumeMount[] = (spec.volumes ?? []).map((v, i) => ({ name: `vol-${i}`, mountPath: v.target, readOnly: v.readOnly }));
    const resources: k8s.V1ResourceRequirements | undefined = spec.resources ? {
      limits: {
        ...(spec.resources.memoryMb ? { memory: `${spec.resources.memoryMb}Mi` } : {}),
        ...(spec.resources.cpus     ? { cpu: String(spec.resources.cpus) }       : {}),
      },
    } : undefined;

    const body: k8s.V1Deployment = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name, namespace: DEFAULT_NS, labels },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: name } },
        template: {
          metadata: { labels },
          spec: {
            containers: [{
              name: 'agent',
              image: spec.image,
              command: spec.command,
              env: envVars.length ? envVars : undefined,
              ports: ports.length ? ports : undefined,
              volumeMounts: volumeMounts.length ? volumeMounts : undefined,
              resources,
            }],
            volumes: volumes.length ? volumes : undefined,
          },
        },
      },
    };

    // Idempotent: replace if exists, create if not
    try {
      await this.apps.replaceNamespacedDeployment({ name, namespace: DEFAULT_NS, body });
      this.logger.log(`Replaced Deployment ${DEFAULT_NS}/${name}`);
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode === 404) {
        await this.apps.createNamespacedDeployment({ namespace: DEFAULT_NS, body });
        this.logger.log(`Created Deployment ${DEFAULT_NS}/${name}`);
      } else {
        throw e;
      }
    }

    if (spec.ports?.length) {
      await this.upsertService(name, DEFAULT_NS, labels, spec.ports);
    }

    return {
      id: encodeHandle(DEFAULT_NS, name),
      kind: this.kind,
      agentId: spec.agentId,
      name: spec.name,
      phase: 'pending',
      createdAt: new Date().toISOString(),
    };
  }

  async stop(handleId: string): Promise<void> {
    const { namespace, name } = decodeHandle(handleId);
    const dep = await this.apps.readNamespacedDeployment({ name, namespace });
    const body = { ...dep, spec: { ...dep.spec, replicas: 0 } };
    await this.apps.replaceNamespacedDeployment({ name, namespace, body });
    this.logger.log(`Scaled ${namespace}/${name} to 0`);
  }

  async remove(handleId: string): Promise<void> {
    const { namespace, name } = decodeHandle(handleId);
    await this.apps.deleteNamespacedDeployment({ name, namespace }).catch(ignoreNotFound);
    await this.core.deleteNamespacedService({ name, namespace }).catch(ignoreNotFound);
    this.logger.log(`Deleted Deployment + Service ${namespace}/${name}`);
  }

  async status(handleId: string): Promise<RuntimeStatus> {
    const { namespace, name } = decodeHandle(handleId);
    const dep = await this.apps.readNamespacedDeployment({ name, namespace });
    const phase = mapDeploymentPhase(dep);
    const msg = dep.status?.conditions?.find((c) => c.type === 'Available')?.message;
    return { phase, message: msg };
  }

  async logs(handleId: string, opts?: LogOptions): Promise<string> {
    const { namespace, name } = decodeHandle(handleId);
    const agentId = name.replace(/^agent-/, '');

    const podList = await this.core.listNamespacedPod({
      namespace,
      labelSelector: `${AGENT_ID_LABEL}=${agentId}`,
    });

    const pod = podList.items.find((p) => p.status?.phase === 'Running') ?? podList.items[0];
    if (!pod?.metadata?.name) return `No pods found for ${namespace}/${name}`;

    const log = await this.core.readNamespacedPodLog({
      name: pod.metadata.name,
      namespace,
      container: 'agent',
      tailLines: opts?.tail ?? 200,
    });

    return typeof log === 'string' ? log : JSON.stringify(log);
  }

  async exec(handleId: string, command: string): Promise<ExecResult> {
    const { namespace, name } = decodeHandle(handleId);

    const podList = await this.core.listNamespacedPod({ namespace, labelSelector: `app=${name}` });
    const pod = podList.items.find((p) => p.status?.phase === 'Running');
    if (!pod?.metadata?.name) {
      return { exitCode: 1, stdout: '', stderr: `No running pod for ${namespace}/${name}` };
    }

    return new Promise((resolve) => {
      const exec = new k8s.Exec(this.kc);
      const stdout: string[] = [];
      const stderr: string[] = [];

      const stdoutStream = { write: (s: string) => { stdout.push(s); return true; }, end: () => {}, on: () => {}, } as any;
      const stderrStream = { write: (s: string) => { stderr.push(s); return true; }, end: () => {}, on: () => {}, } as any;

      exec.exec(
        namespace, pod.metadata!.name!, 'agent',
        ['sh', '-c', command],
        stdoutStream, stderrStream, null, false,
        (status: k8s.V1Status) => {
          resolve({
            exitCode: status.status === 'Success' ? 0 : 1,
            stdout: stdout.join(''),
            stderr: stderr.join(''),
          });
        },
      ).catch((err: Error) => resolve({ exitCode: 1, stdout: '', stderr: err.message }));
    });
  }

  async list(): Promise<RuntimeHandle[]> {
    const depList = await this.apps.listNamespacedDeployment({
      namespace: DEFAULT_NS,
      labelSelector: `${MANAGED_LABEL}=true`,
    });
    return depList.items.map((dep) => ({
      id: encodeHandle(DEFAULT_NS, dep.metadata?.name ?? ''),
      kind: this.kind,
      agentId: dep.metadata?.labels?.[AGENT_ID_LABEL] ?? '',
      name: dep.metadata?.name ?? '',
      phase: mapDeploymentPhase(dep),
      createdAt: dep.metadata?.creationTimestamp?.toISOString() ?? new Date().toISOString(),
    }));
  }

  // ── internals ────────────────────────────────────────────────────────────────

  private async ensureNamespace(namespace: string): Promise<void> {
    try {
      await this.core.readNamespace({ name: namespace });
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode === 404) {
        await this.core.createNamespace({ body: { metadata: { name: namespace, labels: { [MANAGED_LABEL]: 'true' } } } });
        this.logger.log(`Created namespace ${namespace}`);
      } else {
        throw e;
      }
    }
  }

  private async upsertService(
    name: string,
    namespace: string,
    labels: Record<string, string>,
    ports: NonNullable<AgentSpec['ports']>,
  ): Promise<void> {
    const body: k8s.V1Service = {
      apiVersion: 'v1', kind: 'Service',
      metadata: { name, namespace, labels },
      spec: {
        selector: { app: name },
        ports: ports.map((p) => ({ port: p.host ?? p.container, targetPort: p.container as any, protocol: 'TCP' })),
      },
    };
    try {
      await this.core.replaceNamespacedService({ name, namespace, body });
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode === 404) {
        await this.core.createNamespacedService({ namespace, body });
      } else {
        throw e;
      }
    }
  }
}

function ignoreNotFound(err: unknown): void {
  if ((err as { statusCode?: number }).statusCode !== 404) throw err;
}
