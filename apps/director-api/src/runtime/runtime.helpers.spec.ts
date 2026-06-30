import {
  buildCreateOptions,
  containerName,
  demuxDockerLogs,
  mapDockerPhase,
  toEnvArray,
} from './runtime.helpers';

describe('runtime.helpers', () => {
  it('mapDockerPhase maps Docker states to runtime phases', () => {
    expect(mapDockerPhase('running')).toBe('running');
    expect(mapDockerPhase('created')).toBe('pending');
    expect(mapDockerPhase('exited', 0)).toBe('stopped');
    expect(mapDockerPhase('exited', 137)).toBe('failed');
    expect(mapDockerPhase('dead', 1)).toBe('failed');
    expect(mapDockerPhase('weird')).toBe('unknown');
  });

  it('containerName sanitizes invalid chars', () => {
    expect(containerName('abc-123')).toBe('agent-abc-123');
    expect(containerName('a/b c')).toBe('agent-a-b-c');
  });

  it('toEnvArray turns a record into KEY=VALUE', () => {
    expect(toEnvArray({ A: '1', B: 'x' })).toEqual(['A=1', 'B=x']);
    expect(toEnvArray()).toEqual([]);
  });

  it('buildCreateOptions sets management labels and resource limits', () => {
    const opts = buildCreateOptions({
      agentId: 'id1',
      name: 'n',
      image: 'alpine',
      env: { K: 'V' },
      resources: { cpus: 2, memoryMb: 256 },
      ports: [{ container: 80, host: 8080 }],
    });
    expect(opts.name).toBe('agent-id1');
    expect(opts.Labels?.['agent-cloud.managed']).toBe('true');
    expect(opts.Labels?.['agent-cloud.agentId']).toBe('id1');
    expect(opts.Env).toContain('K=V');
    expect(opts.HostConfig?.Memory).toBe(256 * 1024 * 1024);
    expect(opts.HostConfig?.NanoCpus).toBe(2_000_000_000);
    expect(opts.HostConfig?.PortBindings).toEqual({ '80/tcp': [{ HostPort: '8080' }] });
  });

  it('demuxDockerLogs strips 8-byte frame headers', () => {
    const payload = 'hello';
    const frame = Buffer.alloc(8 + payload.length);
    frame.writeUInt8(1, 0); // stdout stream
    frame.writeUInt32BE(payload.length, 4);
    frame.write(payload, 8);
    expect(demuxDockerLogs(frame)).toBe('hello');
  });

  it('demuxDockerLogs falls back to raw text for TTY buffers', () => {
    expect(demuxDockerLogs(Buffer.from('plain'))).toBe('plain');
  });
});
