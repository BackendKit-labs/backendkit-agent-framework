import { ServiceUnavailableException } from '@nestjs/common';
import { K8sRuntimeAdapter } from './k8s.adapter';
import { ProcessRuntimeAdapter } from './process.adapter';
import type { RuntimeAdapter } from '../runtime.spi';

describe.each<[string, () => RuntimeAdapter]>([
  ['k8s', () => new K8sRuntimeAdapter()],
  ['process', () => new ProcessRuntimeAdapter()],
])('ComingSoonAdapter: %s', (kind, make) => {
  const adapter = make();

  it('advertises itself as coming_soon', () => {
    expect(adapter.kind).toBe(kind);
    expect(adapter.availability).toBe('coming_soon');
    expect(adapter.capabilities().every((c) => c.status === 'coming_soon')).toBe(true);
  });

  it('ping reports coming_soon (not reachable, no error)', async () => {
    const status = await adapter.ping();
    expect(status.reachable).toBe('coming_soon');
    expect(status.error).toBeNull();
  });

  it('every lifecycle call throws an explicit 503 (no fake success)', async () => {
    await expect(adapter.deploy({ agentId: 'a', name: 'n', image: 'x' })).rejects.toThrow(
      ServiceUnavailableException,
    );
    await expect(adapter.stop('h')).rejects.toThrow(ServiceUnavailableException);
    await expect(adapter.remove('h')).rejects.toThrow(ServiceUnavailableException);
    await expect(adapter.status('h')).rejects.toThrow(ServiceUnavailableException);
    await expect(adapter.logs('h')).rejects.toThrow(ServiceUnavailableException);
    await expect(adapter.exec('h', 'cmd')).rejects.toThrow(ServiceUnavailableException);
    await expect(adapter.list()).rejects.toThrow(ServiceUnavailableException);
  });
});
