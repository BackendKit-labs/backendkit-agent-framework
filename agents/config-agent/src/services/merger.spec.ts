import { describe, it, expect } from '@jest/globals';
import { mergeConfigs } from './merger.js';

describe('mergeConfigs', () => {
  // ========== merge mode ==========

  it('merge agrega una nueva key', () => {
    const current = { host: 'localhost', port: 3000 };
    const incoming = { logLevel: 'info' };

    const result = mergeConfigs(current, incoming, 'merge');

    expect(result.config).toEqual({ host: 'localhost', port: 3000, logLevel: 'info' });
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].action).toBe('added');
    expect(result.changes[0].key).toBe('logLevel');
  });

  it('merge actualiza una key existente', () => {
    const current = { host: 'localhost', port: 3000 };
    const incoming = { port: 8080 };

    const result = mergeConfigs(current, incoming, 'merge');

    expect(result.config.port).toBe(8080);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].action).toBe('updated');
    expect(result.changes[0].previousValue).toBe(3000);
    expect(result.changes[0].newValue).toBe(8080);
  });

  it('merge no borra keys que no están en incoming', () => {
    const current = { host: 'localhost', port: 3000, debug: true };
    const incoming = { port: 8080 };

    const result = mergeConfigs(current, incoming, 'merge');

    expect(result.config).toEqual({ host: 'localhost', port: 8080, debug: true });
    // Solo port cambia, host y debug se mantienen
    expect(result.changes).toHaveLength(1);
  });

  it('merge skipea keys con mismo valor', () => {
    const current = { host: 'localhost', port: 3000 };
    const incoming = { host: 'localhost', port: 3000 };

    const result = mergeConfigs(current, incoming, 'merge');

    expect(result.changes).toHaveLength(2);
    expect(result.changes.every(c => c.action === 'skipped')).toBe(true);
    expect(result.config).toEqual(current);
  });

  // ========== overwrite mode ==========

  it('overwrite reemplaza todo el config', () => {
    const current = { host: 'localhost', port: 3000, debug: true };
    const incoming = { host: 'example.com', logLevel: 'info' };

    const result = mergeConfigs(current, incoming, 'overwrite');

    expect(result.config).toEqual({ host: 'example.com', logLevel: 'info' });
    // port y debug se borran, host se actualiza, logLevel se agrega
  });

  it('overwrite borra lo que no está en incoming', () => {
    const current = { a: 1, b: 2, c: 3 };
    const incoming = { a: 10 };

    const result = mergeConfigs(current, incoming, 'overwrite');

    expect(result.config).toEqual({ a: 10 });
    const deleted = result.changes.filter(c => c.action === 'deleted');
    expect(deleted).toHaveLength(2);
    expect(deleted.map(d => d.key).sort()).toEqual(['b', 'c']);
  });

  // ========== dry-run mode ==========

  it('dry-run no modifica el config (devuelve vacío)', () => {
    const current = { host: 'localhost', port: 3000 };
    const incoming = { port: 8080, logLevel: 'info' };

    const result = mergeConfigs(current, incoming, 'dry-run');

    expect(result.config).toEqual({});
    expect(result.changes).toHaveLength(2);
    // Pero el current original no se modifica
    expect(current).toEqual({ host: 'localhost', port: 3000 });
  });

  it('dry-run reporta cambios sin persistir', () => {
    const current = { host: 'localhost' };
    const incoming = { host: 'example.com', port: 8080 };

    const result = mergeConfigs(current, incoming, 'dry-run');

    const updated = result.changes.find(c => c.action === 'updated');
    expect(updated?.key).toBe('host');
    const added = result.changes.find(c => c.action === 'added');
    expect(added?.key).toBe('port');
    expect(result.changes).toHaveLength(2);
  });

  // ========== summary ==========

  it('summary refleja las acciones correctas', () => {
    const current = { a: 1, b: 2 };
    const incoming = { b: 3, c: 4 };

    const result = mergeConfigs(current, incoming, 'merge');

    expect(result.summary).toContain('1 agregados');
    expect(result.summary).toContain('1 actualizados');
    // a:1 se skipea (mismo valor no está en incoming, merge no borra)
    // En merge, solo se procesan keys de incoming. a no está en incoming, no aparece.
    // b: 2→3 (updated), c:4 (added) → 2 cambios
    expect(result.changes).toHaveLength(2);
  });
});
