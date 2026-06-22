import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('../storage/versionedStore.js', () => ({
  readVersion: jest.fn(),
  writeVersion: jest.fn(),
}));

const { readVersion, writeVersion } = await import('../storage/versionedStore.js');
const { importConfig } = await import('./importConfig.js');

describe('importConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (readVersion as jest.Mock).mockReturnValue({
      version: 'v1',
      config: { host: 'localhost', port: 3000 },
    });
    (writeVersion as jest.Mock).mockReturnValue({
      version: 'v2',
      createdAt: new Date().toISOString(),
      message: 'import json (merge)',
      agent_id: 'test-agent',
      config: { host: 'localhost', port: 8080, logLevel: 'info' },
      changes: [{ key: 'port', action: 'updated' }, { key: 'logLevel', action: 'added' }],
      checksum: 'abc',
    });
  });

  it('import json en modo merge', async () => {
    const result = await importConfig({
      agent_id: 'test-agent',
      format: 'json',
      content: JSON.stringify({ port: 8080, logLevel: 'info' }),
      mode: 'merge',
    });

    expect(result.newVersion).toBe('v2');
    expect(result.changes).toHaveLength(2);
    expect(result.changes.find(c => c.key === 'port')?.action).toBe('updated');
    expect(result.changes.find(c => c.key === 'logLevel')?.action).toBe('added');
    expect(writeVersion as jest.Mock).toHaveBeenCalled();
  });

  it('import env', async () => {
    const envContent = `
      # Comentario
      PORT=9090
      DEBUG=true
      HOST="localhost"
    `;

    const result = await importConfig({
      agent_id: 'test-agent',
      format: 'env',
      content: envContent,
      mode: 'merge',
    });

    expect(result.changes.length).toBeGreaterThan(0);
    // PORT debe parsearse como número
    const portChange = result.changes.find(c => c.key === 'PORT');
    expect(portChange).toBeDefined();
    // DEBUG debe parsearse como booleano
    const debugChange = result.changes.find(c => c.key === 'DEBUG');
    expect(debugChange).toBeDefined();
  });

  it('import dry-run no persiste', async () => {
    const result = await importConfig({
      agent_id: 'test-agent',
      format: 'json',
      content: JSON.stringify({ port: 8080 }),
      mode: 'dry-run',
    });

    expect(result.newVersion).toBeUndefined();
    expect(writeVersion as jest.Mock).not.toHaveBeenCalled();
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].key).toBe('port');
  });

  it('error si no hay contenido', async () => {
    await expect(
      importConfig({
        agent_id: 'test-agent',
        format: 'json',
        content: '',
        mode: 'merge',
      })
    ).rejects.toThrow('No me diste contenido');
  });

  it('error si content es undefined', async () => {
    await expect(
      importConfig({
        agent_id: 'test-agent',
        format: 'json',
        content: undefined as any,
        mode: 'merge',
      })
    ).rejects.toThrow('No me diste contenido');
  });

  it('error si el JSON es inválido', async () => {
    await expect(
      importConfig({
        agent_id: 'test-agent',
        format: 'json',
        content: '{ broken json }',
        mode: 'merge',
      })
    ).rejects.toThrow('Error al parsear JSON');
  });

  it('error si el formato no es soportado', async () => {
    await expect(
      importConfig({
        agent_id: 'test-agent',
        format: 'yaml' as any,
        content: 'key: value',
        mode: 'merge',
      })
    ).rejects.toThrow('no soportado');
  });

  it('import overwrite reemplaza todo', async () => {
    const result = await importConfig({
      agent_id: 'test-agent',
      format: 'json',
      content: JSON.stringify({ newKey: 'value' }),
      mode: 'overwrite',
    });

    expect(result.changes.some(c => c.action === 'deleted')).toBe(true);
    expect(writeVersion as jest.Mock).toHaveBeenCalled();
  });

  it('import env con valores numéricos y booleanos', async () => {
    const envContent = 'COUNT=42\nENABLED=true\nRATE=3.14';

    const result = await importConfig({
      agent_id: 'test-agent',
      format: 'env',
      content: envContent,
      mode: 'merge',
    });

    // Verificar que se parsearon correctamente
    const countChange = result.changes.find(c => c.key === 'COUNT');
    expect(countChange?.newValue).toBe(42);
    const enabledChange = result.changes.find(c => c.key === 'ENABLED');
    expect(enabledChange?.newValue).toBe(true);
    const rateChange = result.changes.find(c => c.key === 'RATE');
    expect(rateChange?.newValue).toBe(3.14);
  });
});
