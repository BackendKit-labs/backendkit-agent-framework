import { Module, OnModuleInit } from '@nestjs/common';
import { RuntimeRegistry } from './runtime.registry';
import { DockerRuntimeAdapter } from './adapters/docker.adapter';
import { K8sRuntimeAdapter } from './adapters/k8s.adapter';
import { ProcessRuntimeAdapter } from './adapters/process.adapter';

/**
 * Wires the runtime adapters into the registry.
 *
 * RUNTIME_ENABLED (comma-separated, default: "docker") controls which adapters
 * are registered as available. Unregistered adapters still appear in
 * GET /director/runtimes but report `coming_soon`.
 *
 * Examples:
 *   RUNTIME_ENABLED=docker           → Docker only (default)
 *   RUNTIME_ENABLED=k8s              → k8s only (prod cluster)
 *   RUNTIME_ENABLED=docker,k8s       → both (hybrid/migration)
 *
 * k8s config:
 *   K8S_KUBECONFIG  — path to kubeconfig (optional; falls back to in-cluster)
 *   K8S_NAMESPACE   — target namespace (default: agent-cloud)
 */
@Module({
  providers: [
    RuntimeRegistry,
    DockerRuntimeAdapter,
    K8sRuntimeAdapter,
    ProcessRuntimeAdapter,
  ],
  exports: [RuntimeRegistry],
})
export class RuntimeModule implements OnModuleInit {
  constructor(
    private readonly registry: RuntimeRegistry,
    private readonly docker: DockerRuntimeAdapter,
    private readonly k8s: K8sRuntimeAdapter,
    private readonly process: ProcessRuntimeAdapter,
  ) {}

  onModuleInit(): void {
    const enabled = (process.env.RUNTIME_ENABLED ?? 'docker')
      .split(',')
      .map((s) => s.trim());

    if (enabled.includes('docker')) this.registry.register(this.docker);
    if (enabled.includes('k8s'))    this.registry.register(this.k8s);

    // process adapter always stays coming_soon — registered for visibility only
    this.registry.register(this.process);
  }
}
