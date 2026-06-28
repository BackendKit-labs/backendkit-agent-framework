import { RuntimeReconciler } from './runtime.reconciler';
import { Agent, AgentStatus } from '../agents/entities/agent.entity';
import type { RuntimeAdapter, RuntimeHandle } from './runtime.spi';

function agent(partial: Partial<Agent>): Agent {
  return {
    id: 'a1',
    name: 'A',
    description: null,
    type: 'backend',
    status: AgentStatus.ACTIVE,
    config: {},
    projectId: null,
    model: null,
    runtime: 'docker',
    image: null,
    runtimeHandle: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
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
  it('marks an active agent STOPPED when its container is gone', async () => {
    const stale = agent({ status: AgentStatus.ACTIVE, runtimeHandle: 'container-gone' });
    const repo = { find: jest.fn().mockResolvedValue([stale]), save: jest.fn(async (a) => a) };
    const registry = { all: () => [adapter([])] };

    const reconciler = new RuntimeReconciler(repo as any, registry as any);
    await reconciler.onApplicationBootstrap();

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: AgentStatus.STOPPED, runtimeHandle: null }),
    );
  });

  it('keeps an agent ACTIVE when its container is still running', async () => {
    const running = agent({ status: AgentStatus.STOPPED, runtimeHandle: 'c1' });
    const handle: RuntimeHandle = {
      id: 'c1',
      kind: 'docker',
      agentId: 'a1',
      name: 'A',
      phase: 'running',
      createdAt: 'now',
    };
    const repo = { find: jest.fn().mockResolvedValue([running]), save: jest.fn(async (a) => a) };
    const registry = { all: () => [adapter([handle])] };

    const reconciler = new RuntimeReconciler(repo as any, registry as any);
    await reconciler.onApplicationBootstrap();

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: AgentStatus.ACTIVE }),
    );
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
