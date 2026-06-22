import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('../storage/secretStore.js', () => ({
  writeSecret: jest.fn(),
}));

jest.unstable_mockModule('../storage/versionedStore.js', () => ({
  readVersion: jest.fn(),
  writeVersion: jest.fn(),
}));

const { writeSecret } = await import('../storage/secretStore.js');
const { readVersion, writeVersion } = await import('../storage/versionedStore.js');
const mockedWriteVersion = jest.mocked(writeVersion);
const { setSecret } = await import('./setSecret.js');

describe('setSecret', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (readVersion as jest.Mock).mockReturnValue({
      version: 'v1',
      config: { host: 'localhost' },
    });
    mockedWriteVersion.mockReturnValue({
      version: 'v2',
      createdAt: new Date().toISOString(),
      message: 'set secret api_key',
      agent_id: 'test-agent',
      config: { host: 'localhost', api_key: '🔒 encriptado' },
      changes: [{ key: 'api_key', action: 'added' }],
      checksum: 'abc',
    });
  });

  it('set exitoso de un secreto', async () => {
    const result = await setSecret({
      agent_id: 'test-agent',
      key: 'api_key',
      value: 'sk-123456',
    });

    expect(result.key).toBe('api_key');
    expect(result.status).toBe('encrypted');
    expect(result.newVersion).toBe('v2');
    expect(writeSecret as jest.Mock).toHaveBeenCalledWith('test-agent', 'api_key', 'sk-123456');
    expect(mockedWriteVersion).toHaveBeenCalled();
  });

  it('error si no hay key', async () => {
    await expect(
      setSecret({ agent_id: 'test-agent', key: '', value: 'secret' })
    ).rejects.toThrow('Debes especificar una clave');
  });

  it('error si key es undefined', async () => {
    await expect(
      setSecret({ agent_id: 'test-agent', key: undefined as any, value: 'secret' })
    ).rejects.toThrow('Debes especificar una clave');
  });

  it('error si no hay value', async () => {
    await expect(
      setSecret({ agent_id: 'test-agent', key: 'api_key', value: '' })
    ).rejects.toThrow('No me diste el valor');
  });

  it('error si value es undefined', async () => {
    await expect(
      setSecret({ agent_id: 'test-agent', key: 'api_key', value: undefined as any })
    ).rejects.toThrow('No me diste el valor');
  });

  it('actualiza config existente con marcador de secreto', async () => {
    (readVersion as jest.Mock).mockReturnValue({
      version: 'v1',
      config: { host: 'localhost', api_key: 'old-key' },
    });

    await setSecret({
      agent_id: 'test-agent',
      key: 'api_key',
      value: 'new-key',
    });

    // writeVersion debe recibir config con '🔒 encriptado'
    expect(mockedWriteVersion).toHaveBeenCalledWith(
      'test-agent',
      expect.objectContaining({ api_key: '🔒 encriptado' }),
      expect.any(Array),
      expect.any(String)
    );
  });

  it('incluye reloadTriggered cuando se pasa reload: true', async () => {
    const result = await setSecret({
      agent_id: 'test-agent',
      key: 'api_key',
      value: 'secret',
      reload: true,
    });

    expect(result.reloadTriggered).toBe(true);
  });
});
