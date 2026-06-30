import { createDockerClient } from '../runtime.helpers';
import { DockerRuntimeAdapter } from './docker.adapter';
import type { RuntimeHandle } from '../runtime.spi';

/**
 * Real Docker integration. Skips automatically when the daemon is unreachable so
 * CI without Docker stays green. Run with Docker Desktop up to exercise it.
 */
describe('DockerRuntimeAdapter (integration)', () => {
  const adapter = new DockerRuntimeAdapter();
  const agentId = `it-${Date.now()}`;
  let dockerUp = false;
  let handle: RuntimeHandle | undefined;

  beforeAll(async () => {
    const status = await adapter.ping();
    dockerUp = status.reachable === 'reachable';
    if (!dockerUp) {
      // eslint-disable-next-line no-console
      console.warn(`[skip] Docker no disponible: ${status.error}`);
    }
  }, 30_000);

  afterAll(async () => {
    if (handle) {
      await adapter.remove(handle.id).catch(() => undefined);
    }
  }, 30_000);

  const itDocker = (name: string, fn: () => Promise<void>, timeout?: number) =>
    it(name, async () => {
      if (!dockerUp) return;
      await fn();
    }, timeout);

  itDocker('deploys, inspects, logs, execs, and stops an alpine agent', async () => {
    handle = await adapter.deploy({
      agentId,
      name: `agent-${agentId}`,
      image: 'alpine:3.20',
      command: ['sh', '-c', 'echo hello-floci; sleep 30'],
    });
    expect(handle.id).toBeTruthy();
    expect(handle.phase).toBe('running');

    const status = await adapter.status(handle.id);
    expect(status.phase).toBe('running');

    const logs = await adapter.logs(handle.id, { tail: 10 });
    expect(logs).toContain('hello-floci');

    const exec = await adapter.exec(handle.id, 'echo exec-ok');
    expect(exec.exitCode).toBe(0);
    expect(exec.stdout).toContain('exec-ok');

    const listed = await adapter.list();
    expect(listed.some((h) => h.agentId === agentId)).toBe(true);

    await adapter.stop(handle.id);
    const stopped = await adapter.status(handle.id);
    expect(['stopped', 'failed']).toContain(stopped.phase);
  }, 120_000);
});
