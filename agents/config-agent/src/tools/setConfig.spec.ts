import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { ConfigSchema } from '../types/schema.js';

// Usar unstable_mockModule para ESM — requiere top-level await
jest.unstable_mockModule('../storage/versionedStore.js', () => ({
  readVersion: jest.fn(),
  writeVersion: jest.fn(),
}));

jest.unstable_mockModule('../storage/secretStore.js', () => ({
  readSecrets: jest.fn(),
}));

jest.unstable_mockModule('../storage/schemaStore.js', () => ({
  readSchema: jest.fn(),
}));

const { readVersion, writeVersion } = await import('../storage/versionedStore.js');
const { readSecrets } = await import('../storage/secretStore.js');
const { readSchema } = await import('../storage/schemaStore.js');
const { setConfig } = await import('./setConfig.js');

describe('setConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mocks
    (readVersion as jest.Mock).mockReturnValue({
      version: 'v1',
      config: { host: 'localhost' },
    });
    (writeVersion as jest.Mock).mockReturnValue({
      version: 'v2',
      createdAt: new Date().toISOString(),
      message: 'update port',
      agent_id: 'test-agent',
      config: { host: 'localhost', port: 8080 },
      changes: [{ key: 'port', action: 'added' }],
      checksum: 'abc',
    });
    (readSecrets as jest.Mock).mockReturnValue({});
    (readSchema as jest.Mock).mockReturnValue(null);
  });

  it('set exitoso de una nueva key', async () => {
    const result = await setConfig({
      agent_id: 'test-agent',
      key: 'port',
      value: 8080,
    });

    expect(result.key).toBe('port');
    expect(result.newValue).toBe(8080);
    expect(result.previousValue).toBeUndefined();
    expect(result.newVersion).toBe('v2');
    expect(writeVersion as jest.Mock).toHaveBeenCalled();
  });

  it('set exitoso actualizando una key existente', async () => {
    (readVersion as jest.Mock).mockReturnValue({
      version: 'v1',
      config: { host: 'localhost', port: 3000 },
    });

    const result = await setConfig({
      agent_id: 'test-agent',
      key: 'port',
      value: 8080,
    });

    expect(result.previousValue).toBe(3000);
    expect(result.newValue).toBe(8080);
  });

  it('error si key es secreto conocido por schema', async () => {
    (readSchema as jest.Mock).mockReturnValue({
      fields: {
        api_key: { type: 'secret', required: true, secret: true },
      },
    } as ConfigSchema);

    await expect(
      setConfig({ agent_id: 'test-agent', key: 'api_key', value: 'sk-123' })
    ).rejects.toThrow('es un secreto');
  });

  it('error si key está en secrets store', async () => {
    (readSecrets as jest.Mock).mockReturnValue({ db_password: 'encrypted' });

    await expect(
      setConfig({ agent_id: 'test-agent', key: 'db_password', value: 'newpass' })
    ).rejects.toThrow('es un secreto almacenado');
  });

  it('error si no se especifica key', async () => {
    await expect(
      setConfig({ agent_id: 'test-agent', key: '', value: 'x' })
    ).rejects.toThrow('Debes especificar una clave');
  });

  it('error si value es undefined', async () => {
    await expect(
      setConfig({ agent_id: 'test-agent', key: 'port', value: undefined })
    ).rejects.toThrow('No me diste el valor');
  });

  it('error si value es null', async () => {
    await expect(
      setConfig({ agent_id: 'test-agent', key: 'port', value: null })
    ).rejects.toThrow('No me diste el valor');
  });

  it('valida contra schema si existe para la key', async () => {
    (readSchema as jest.Mock).mockReturnValue({
      fields: {
        port: { type: 'number', required: true, min: 1024, max: 65535, secret: false },
      },
    } as ConfigSchema);

    await expect(
      setConfig({ agent_id: 'test-agent', key: 'port', value: 80 })
    ).rejects.toThrow('no pasa la validación');
  });

  it('incluye reloadTriggered cuando se pasa reload: true', async () => {
    const result = await setConfig({
      agent_id: 'test-agent',
      key: 'port',
      value: 8080,
      reload: true,
    });

    expect(result.reloadTriggered).toBe(true);
  });
});
