/**
 * Test mock for `@kubernetes/client-node`.
 *
 * The real package ships ESM that the repo's ts-jest/CommonJS pipeline does not
 * transform (it lives under node_modules, which `transformIgnorePatterns` skips),
 * so any spec that transitively imports `k8s.adapter` would fail to parse it.
 *
 * Unit tests never exercise the k8s runtime; they only need the module to be
 * importable so `RuntimeModule` can instantiate `K8sRuntimeAdapter`. These stubs
 * cover the only runtime symbols the adapter touches (KubeConfig, Exec,
 * CoreV1Api, AppsV1Api). All type-only imports are erased at compile time.
 */
export class KubeConfig {
  loadFromFile(): void {}
  loadFromCluster(): void {}
  loadFromDefault(): void {}
  makeApiClient(): unknown {
    return {};
  }
}

export class Exec {}
export class CoreV1Api {}
export class AppsV1Api {}
