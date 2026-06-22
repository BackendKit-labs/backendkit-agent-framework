import { describe, it, expect } from '@jest/globals';
import { diffConfigs } from './differ.js';

describe('diffConfigs', () => {
  it('detecta added, removed y updated', () => {
    const oldConfig = { host: 'localhost', port: 3000, debug: false };
    const newConfig = { host: 'localhost', port: 8080, logLevel: 'info' };

    const result = diffConfigs(oldConfig, newConfig);

    expect(result.changes).toHaveLength(3);

    const added = result.changes.find(c => c.type === 'added');
    expect(added?.key).toBe('logLevel');
    expect(added?.to).toBe('info');

    const removed = result.changes.find(c => c.type === 'removed');
    expect(removed?.key).toBe('debug');
    expect(removed?.from).toBe(false);

    const updated = result.changes.find(c => c.type === 'updated');
    expect(updated?.key).toBe('port');
    expect(updated?.from).toBe(3000);
    expect(updated?.to).toBe(8080);
  });

  it('retorna sin cambios cuando las configs son iguales', () => {
    const config = { host: 'localhost', port: 3000 };
    const result = diffConfigs(config, config);
    expect(result.changes).toHaveLength(0);
    expect(result.summary).toContain('0 cambios');
  });

  it('genera textDiff en formato text', () => {
    const oldConfig = { host: 'localhost' };
    const newConfig = { host: 'example.com', port: 8080 };

    const result = diffConfigs(oldConfig, newConfig, 'text');

    expect(result.textDiff).toBeDefined();
    expect(result.textDiff).toContain('~host:');
    expect(result.textDiff).toContain('+port:');
  });

  it('todas las keys iguales (mismos valores)', () => {
    const oldConfig = { a: 1, b: 2, c: 3 };
    const newConfig = { a: 1, b: 2, c: 3 };

    const result = diffConfigs(oldConfig, newConfig);

    expect(result.changes).toHaveLength(0);
    expect(result.summary).toBe('0 cambios: 0 agregados, 0 modificados, 0 eliminados');
  });

  it('detecta cambios con objetos anidados', () => {
    const oldConfig = { db: { host: 'localhost', port: 5432 } };
    const newConfig = { db: { host: 'localhost', port: 5432 } };

    const result = diffConfigs(oldConfig, newConfig);
    expect(result.changes).toHaveLength(0);
  });

  it('detecta cambio en objeto anidado', () => {
    const oldConfig = { db: { host: 'localhost', port: 5432 } };
    const newConfig = { db: { host: 'localhost', port: 5433 } };

    const result = diffConfigs(oldConfig, newConfig);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].type).toBe('updated');
    expect(result.changes[0].key).toBe('db');
  });

  it('summary refleja cantidades correctas', () => {
    const oldConfig = { a: 1, b: 2 };
    const newConfig = { b: 3, c: 4 };

    const result = diffConfigs(oldConfig, newConfig);
    expect(result.summary).toContain('3 cambios');
    expect(result.summary).toContain('1 agregados');
    expect(result.summary).toContain('1 modificados');
    expect(result.summary).toContain('1 eliminados');
  });
});
