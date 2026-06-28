import { ServiceUnavailableException } from '@nestjs/common';
import { RuntimeRegistry } from './runtime.registry';
import type {
  AgentSpec,
  RuntimeAdapter,
  RuntimeAvailability,
  RuntimeHandle,
  RuntimeKind,
} from './runtime.spi';

function makeAdapter(
  kind: RuntimeKind,
  availability: RuntimeAvailability,
): RuntimeAdapter {
  return {
    kind,
    availability,
    capabilities: () => [],
    ping: async () => ({
      kind,
      registered: true,
      reachable: availability === 'available' ? 'reachable' : 'coming_soon',
      endpoint: null,
      checkedAt: new Date().toISOString(),
      error: null,
    }),
    deploy: async (spec: AgentSpec): Promise<RuntimeHandle> => ({
      id: 'h1',
      kind,
      agentId: spec.agentId,
      name: spec.name,
      phase: 'running',
      createdAt: new Date().toISOString(),
    }),
    stop: async () => {},
    remove: async () => {},
    status: async () => ({ phase: 'running' }),
    logs: async () => '',
    exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    list: async () => [],
  };
}

describe('RuntimeRegistry', () => {
  it('registers and resolves an available adapter', () => {
    const registry = new RuntimeRegistry();
    const docker = makeAdapter('docker', 'available');
    registry.register(docker);

    expect(registry.get('docker')).toBe(docker);
    expect(registry.require('docker')).toBe(docker);
  });

  it('throws 503 for an unregistered runtime', () => {
    const registry = new RuntimeRegistry();
    expect(() => registry.require('k8s')).toThrow(ServiceUnavailableException);
    expect(registry.get('k8s')).toBeUndefined();
  });

  it('throws 503 for a coming_soon runtime (no faking)', () => {
    const registry = new RuntimeRegistry();
    registry.register(makeAdapter('k8s', 'coming_soon'));
    expect(() => registry.require('k8s')).toThrow(ServiceUnavailableException);
  });

  it('availableKinds excludes coming_soon adapters', () => {
    const registry = new RuntimeRegistry();
    registry.register(makeAdapter('docker', 'available'));
    registry.register(makeAdapter('k8s', 'coming_soon'));
    registry.register(makeAdapter('process', 'coming_soon'));

    expect(registry.availableKinds()).toEqual(['docker']);
    expect(registry.all()).toHaveLength(3);
  });
});
