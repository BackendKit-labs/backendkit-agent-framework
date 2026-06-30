import { AgentCatalog } from './agent-catalog';

describe('AgentCatalog', () => {
  it('seeds a template for every known agent type', () => {
    const catalog = new AgentCatalog();
    const keys = catalog.list().map((t) => t.key);
    expect(keys).toEqual(
      expect.arrayContaining(['backend', 'qa', 'design', 'security', 'infra', 'codex', 'custom']),
    );
    expect(catalog.list().every((t) => t.image.length > 0)).toBe(true);
  });

  it('resolve returns the matching template', () => {
    const catalog = new AgentCatalog();
    const codex = catalog.resolve('codex');
    expect(codex.key).toBe('codex');
    expect(codex.defaultModel).toBe('claude-opus-4-8');
  });

  it('resolve falls back to a generic template for unknown types', () => {
    const catalog = new AgentCatalog();
    const t = catalog.resolve('does-not-exist');
    expect(t.key).toBe('does-not-exist');
    expect(t.image).toBeTruthy();
    expect(t.runtime).toBe('docker');
  });

  it('honors DEFAULT_AGENT_IMAGE for the base image', () => {
    const prev = process.env.DEFAULT_AGENT_IMAGE;
    process.env.DEFAULT_AGENT_IMAGE = 'custom-base:1.2.3';
    try {
      expect(new AgentCatalog().resolve('backend').image).toBe('custom-base:1.2.3');
    } finally {
      if (prev === undefined) delete process.env.DEFAULT_AGENT_IMAGE;
      else process.env.DEFAULT_AGENT_IMAGE = prev;
    }
  });
});
