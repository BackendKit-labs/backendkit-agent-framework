import { RuntimeReconciler } from './runtime.reconciler';
import { Deployable } from '../deployables/entities/deployable.entity';
import type { RuntimeAdapter, RuntimeHandle } from './runtime.spi';

function deployable(partial: Partial<Deployable>): Deployable {
  return {
    id: 'a1',
    name: 'A',
    description: null,
    kind: 'agent',
    status: 'running',
    departmentId: null,
    department: null,
    catalogKey: null,
    image: null,
    runtime: 'docker',
    runtimeHandle: null,
    model: null,
    mcpPort: null,
    publicPort: null,
    publicUrl: null,
    framework: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  } as Deployable;
}

function adapter(handles: RuntimeHandle[]): RuntimeAdapter {
  return {
    kind: 'docker',
    availability: 'available',
    capabilities: () => [],
    ping: jest.fn(),
    deploy: jest.fn(),
    stop: jest.fn(),
    remove: jest.fn(),
    status: jest.fn(),
    logs: jest.fn(),
    exec: jest.fn(),
    list: jest.fn().mockResolvedValue(handles),
  } as unknown as RuntimeAdapter;
}

describe('RuntimeReconciler', () => {
  it('marks a running deployable STOPPED when its container is gone', async () => {
    const stale = deployable({ status: 'running', runtimeHandle: 'container-gone' });
    const repo = { find: jest.fn().mockResolvedValue([stale]), save: jest.fn(async (d) => d) };
    const registry = { all: () => [adapter([])] };

    const reconciler = new RuntimeReconciler(repo as any, registry as any);
    await reconciler.onApplicationBootstrap();

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'stopped', runtimeHandle: null }),
    );
  });

  it('marks a deployable RUNNING when its container is still running', async () => {
    const stopped = deployable({ status: 'stopped', runtimeHandle: 'c1' });
    const handle: RuntimeHandle = {
      id: 'c1',
      kind: 'docker',
      agentId: 'a1',
      name: 'A',
      phase: 'running',
      createdAt: 'now',
    };
    const repo = { find: jest.fn().mockResolvedValue([stopped]), save: jest.fn(async (d) => d) };
    const registry = { all: () => [adapter([handle])] };

    const reconciler = new RuntimeReconciler(repo as any, registry as any);
    await reconciler.onApplicationBootstrap();

    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'running' }));
  });

  it('does not crash when an adapter list() fails', async () => {
    const failing = {
      ...adapter([]),
      list: jest.fn().mockRejectedValue(new Error('daemon down')),
    } as unknown as RuntimeAdapter;
    const repo = { find: jest.fn(), save: jest.fn() };
    const registry = { all: () => [failing] };

    const reconciler = new RuntimeReconciler(repo as any, registry as any);
    await expect(reconciler.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(repo.save).not.toHaveBeenCalled();
  });
});
