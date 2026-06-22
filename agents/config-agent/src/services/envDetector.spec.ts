import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { detectEnvVars } from './envDetector.js';

// Guardar process.env original
const ORIGINAL_ENV = { ...process.env };

describe('detectEnvVars', () => {
  beforeEach(() => {
    // Resetear process.env para cada test
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('detecta nuevas variables de entorno', () => {
    process.env['MYAPP_HOST'] = 'localhost';
    process.env['MYAPP_PORT'] = '3000';

    const result = detectEnvVars([], 'MYAPP_');

    expect(result.detected).toBe(2);
    expect(result.new).toHaveLength(2);
    expect(result.new.find(n => n.key === 'MYAPP_HOST')?.value).toBe('localhost');
    expect(result.new.find(n => n.key === 'MYAPP_PORT')?.value).toBe('3000');
  });

  it('detecta variables actualizadas (conflicto con config existente)', () => {
    process.env['DB_HOST'] = 'new-host.example.com';

    const result = detectEnvVars(['DB_HOST'], undefined, { DB_HOST: 'old-host.example.com' });

    expect(result.detected).toBe(1);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].key).toBe('DB_HOST');
    expect(result.conflicts[0].envValue).toBe('new-host.example.com');
    expect(result.conflicts[0].configValue).toBe('old-host.example.com');
    expect(result.conflicts[0].chosen).toBe('env');
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0].from).toBe('old-host.example.com');
    expect(result.updated[0].to).toBe('new-host.example.com');
  });

  it('detecta conflictos cuando env var difiere de config', () => {
    process.env['PORT'] = '8080';

    const result = detectEnvVars(['PORT'], undefined, { PORT: '3000' });

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].key).toBe('PORT');
  });

  it('ignora valores vacíos en env', () => {
    process.env['EMPTY_VAR'] = '';

    const result = detectEnvVars(['EMPTY_VAR']);

    expect(result.detected).toBe(0);
    expect(result.ignored).toHaveLength(1);
    expect(result.ignored[0].reason).toContain('vacío');
  });

  it('ignora valores default conocidos (your-*)', () => {
    process.env['API_KEY'] = 'your-api-key-here';

    const result = detectEnvVars(['API_KEY']);

    expect(result.detected).toBe(0);
    expect(result.ignored).toHaveLength(1);
    expect(result.ignored[0].reason).toContain('default');
  });

  it('ignora valor "changeme"', () => {
    process.env['PASSWORD'] = 'changeme';

    const result = detectEnvVars(['PASSWORD']);

    expect(result.detected).toBe(0);
    expect(result.ignored).toHaveLength(1);
  });

  it('no detecta conflicto si env var tiene el mismo valor que config', () => {
    process.env['HOST'] = 'localhost';

    const result = detectEnvVars(['HOST'], undefined, { HOST: 'localhost' });

    expect(result.detected).toBe(1);
    expect(result.conflicts).toHaveLength(0);
    expect(result.updated).toHaveLength(0);
    // Cuando el valor es igual, no entra en new (porque ya existe en config)
    // ni en updated (porque no hay diferencia). Solo incrementa detected.
    expect(result.new).toHaveLength(0);
  });

  it('filtra por knownKeys cuando no hay prefijo', () => {
    process.env['IRRELEVANT'] = 'value';
    process.env['TARGET'] = 'found';

    const result = detectEnvVars(['TARGET']);

    expect(result.detected).toBe(1);
    expect(result.new[0].key).toBe('TARGET');
  });

  it('retorna estructura vacía cuando no hay coincidencias', () => {
    const result = detectEnvVars([], 'NONEXISTENT_');

    expect(result.detected).toBe(0);
    expect(result.new).toHaveLength(0);
    expect(result.updated).toHaveLength(0);
    expect(result.ignored).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
  });
});
