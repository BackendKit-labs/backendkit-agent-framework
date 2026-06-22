import { describe, it, expect } from '@jest/globals';
import { validateConfig } from './validator.js';
import type { ConfigSchema } from '../types/schema.js';

describe('validateConfig', () => {
  // ========== Con schema ==========

  it('valida un string correcto', () => {
    const schema: ConfigSchema = {
      fields: { name: { type: 'string', required: true, secret: false } },
    };
    const result = validateConfig({ name: 'Juan' }, schema);
    expect(result.status).toBe('valid');
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('rechaza un string cuando el valor es un número', () => {
    const schema: ConfigSchema = {
      fields: { name: { type: 'string', required: true, secret: false } },
    };
    const result = validateConfig({ name: 42 }, schema);
    expect(result.status).toBe('invalid');
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain('debe ser un string');
  });

  it('valida un number con min y max', () => {
    const schema: ConfigSchema = {
      fields: { port: { type: 'number', required: true, min: 1024, max: 65535, secret: false } },
    };
    const result = validateConfig({ port: 3000 }, schema);
    expect(result.status).toBe('valid');
    expect(result.passed).toBe(1);
  });

  it('rechaza un number por debajo del mínimo', () => {
    const schema: ConfigSchema = {
      fields: { port: { type: 'number', required: true, min: 1024, max: 65535, secret: false } },
    };
    const result = validateConfig({ port: 80 }, schema);
    expect(result.status).toBe('invalid');
    expect(result.errors[0]).toContain('>= 1024');
  });

  it('rechaza un number por encima del máximo', () => {
    const schema: ConfigSchema = {
      fields: { port: { type: 'number', required: true, min: 1024, max: 65535, secret: false } },
    };
    const result = validateConfig({ port: 70000 }, schema);
    expect(result.status).toBe('invalid');
    expect(result.errors[0]).toContain('<= 65535');
  });

  it('valida un boolean correcto', () => {
    const schema: ConfigSchema = {
      fields: { enabled: { type: 'boolean', required: true, secret: false } },
    };
    const result = validateConfig({ enabled: true }, schema);
    expect(result.status).toBe('valid');
    expect(result.passed).toBe(1);
  });

  it('rechaza un boolean cuando el valor no es booleano', () => {
    const schema: ConfigSchema = {
      fields: { enabled: { type: 'boolean', required: true, secret: false } },
    };
    const result = validateConfig({ enabled: 'true' }, schema);
    expect(result.status).toBe('invalid');
    expect(result.errors[0]).toContain('debe ser true o false');
  });

  it('valida una URL correcta', () => {
    const schema: ConfigSchema = {
      fields: { url: { type: 'url', required: true, secret: false } },
    };
    const result = validateConfig({ url: 'https://example.com' }, schema);
    expect(result.status).toBe('valid');
    expect(result.passed).toBe(1);
  });

  it('rechaza una URL inválida', () => {
    const schema: ConfigSchema = {
      fields: { url: { type: 'url', required: true, secret: false } },
    };
    const result = validateConfig({ url: 'not-a-url' }, schema);
    expect(result.status).toBe('invalid');
    expect(result.errors[0]).toContain('no es una URL válida');
  });

  it('valida un select con opción válida', () => {
    const schema: ConfigSchema = {
      fields: {
        mode: { type: 'select', required: true, options: ['dev', 'prod', 'staging'], secret: false },
      },
    };
    const result = validateConfig({ mode: 'prod' }, schema);
    expect(result.status).toBe('valid');
    expect(result.passed).toBe(1);
  });

  it('rechaza un select con opción inválida', () => {
    const schema: ConfigSchema = {
      fields: {
        mode: { type: 'select', required: true, options: ['dev', 'prod', 'staging'], secret: false },
      },
    };
    const result = validateConfig({ mode: 'test' }, schema);
    expect(result.status).toBe('invalid');
    expect(result.errors[0]).toContain('debe ser uno de');
  });

  it('valida un secret con mínimo 4 caracteres', () => {
    const schema: ConfigSchema = {
      fields: { api_key: { type: 'secret', required: true, secret: true } },
    };
    const result = validateConfig({ api_key: 'sk-abc123' }, schema);
    expect(result.status).toBe('valid');
    expect(result.passed).toBe(1);
  });

  it('rechaza un secret con menos de 4 caracteres', () => {
    const schema: ConfigSchema = {
      fields: { api_key: { type: 'secret', required: true, secret: true } },
    };
    const result = validateConfig({ api_key: 'ab' }, schema);
    expect(result.status).toBe('invalid');
    expect(result.errors[0]).toContain('mín. 4 caracteres');
  });

  it('detecta campo requerido ausente', () => {
    const schema: ConfigSchema = {
      fields: { name: { type: 'string', required: true, secret: false } },
    };
    const result = validateConfig({}, schema);
    // Cuando hay errores (missing), el status es 'invalid', no 'incomplete'
    expect(result.status).toBe('invalid');
    expect(result.missingRequired).toContain('name');
    expect(result.checks[0].status).toBe('missing');
  });

  it('advierte sobre keys no definidas en el schema', () => {
    const schema: ConfigSchema = {
      fields: { name: { type: 'string', required: true, secret: false } },
    };
    const result = validateConfig({ name: 'Juan', extra: 'valor' }, schema);
    expect(result.warnings).toContain("'extra' no está definido en el schema");
  });

  it('valida string con pattern', () => {
    const schema: ConfigSchema = {
      fields: {
        email: { type: 'string', required: true, pattern: '^\\S+@\\S+\\.\\S+$', secret: false },
      },
    };
    const result = validateConfig({ email: 'test@example.com' }, schema);
    expect(result.status).toBe('valid');
  });

  it('rechaza string que no coincide con pattern', () => {
    const schema: ConfigSchema = {
      fields: {
        email: { type: 'string', required: true, pattern: '^\\S+@\\S+\\.\\S+$', secret: false },
      },
    };
    const result = validateConfig({ email: 'invalido' }, schema);
    expect(result.status).toBe('invalid');
    expect(result.errors[0]).toContain('patrón');
  });

  // ========== Sin schema ==========

  it('sin schema: valida que no esté vacío', () => {
    const result = validateConfig({ host: 'localhost' });
    expect(result.status).toBe('valid');
    expect(result.passed).toBe(1);
  });

  it('sin schema: detecta valor vacío', () => {
    const result = validateConfig({ host: '' });
    // Sin schema, valores vacíos se marcan como 'missing' → failed > 0 → 'invalid'
    expect(result.status).toBe('invalid');
    expect(result.missingRequired).toContain('host');
  });

  it('sin schema: detecta null como vacío', () => {
    const result = validateConfig({ host: null });
    expect(result.status).toBe('invalid');
    expect(result.missingRequired).toContain('host');
  });

  it('sin schema: detecta undefined como vacío', () => {
    const result = validateConfig({ host: undefined });
    expect(result.status).toBe('invalid');
    expect(result.missingRequired).toContain('host');
  });

  it('sin schema: múltiples keys, algunas vacías', () => {
    const result = validateConfig({ host: 'localhost', port: '', debug: true });
    expect(result.status).toBe('invalid');
    expect(result.missingRequired).toContain('port');
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(1);
  });

  it('campo no requerido ausente no falla', () => {
    const schema: ConfigSchema = {
      fields: { optional: { type: 'string', required: false, secret: false } },
    };
    const result = validateConfig({}, schema);
    expect(result.status).toBe('valid');
    expect(result.checks[0].status).toBe('ok');
  });
});
