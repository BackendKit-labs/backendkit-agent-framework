import { describe, it, expect } from '@jest/globals';
import { inferSchema } from './inferer.js';

describe('inferSchema', () => {
  it('infiere tipo string para un valor string normal', () => {
    const result = inferSchema({ name: 'Juan' });
    expect(result.fields.name.type).toBe('string');
    expect(result.fields.name.required).toBe(true);
  });

  it('infiere tipo number para un valor numérico', () => {
    const result = inferSchema({ port: 3000 });
    expect(result.fields.port.type).toBe('number');
  });

  it('infiere tipo boolean para un valor booleano', () => {
    const result = inferSchema({ enabled: true });
    expect(result.fields.enabled.type).toBe('boolean');
  });

  it('infiere tipo url para un string que es URL válida', () => {
    const result = inferSchema({ endpoint: 'https://api.example.com/v1' });
    expect(result.fields.endpoint.type).toBe('url');
  });

  it('infiere tipo secret para keys que contienen "token"', () => {
    const result = inferSchema({ api_token: 'abc123' });
    expect(result.fields.api_token.type).toBe('secret');
    expect(result.fields.api_token.secret).toBe(true);
  });

  it('infiere tipo secret para keys que contienen "password"', () => {
    const result = inferSchema({ db_password: 's3cret' });
    expect(result.fields.db_password.type).toBe('secret');
    expect(result.fields.db_password.secret).toBe(true);
  });

  it('infiere tipo secret para keys que contienen "api_key"', () => {
    const result = inferSchema({ api_key: 'sk-1234' });
    expect(result.fields.api_key.type).toBe('secret');
    expect(result.fields.api_key.secret).toBe(true);
  });

  it('infiere tipo secret para keys que contienen "secret"', () => {
    const result = inferSchema({ client_secret: 'xyz' });
    expect(result.fields.client_secret.type).toBe('secret');
    expect(result.fields.client_secret.secret).toBe(true);
  });

  it('infiere múltiples campos de diferentes tipos', () => {
    const config = {
      host: 'localhost',
      port: 5432,
      debug: false,
      api_url: 'https://api.example.com',
      db_password: 'pass123',
    };

    const result = inferSchema(config);

    expect(result.fields.host.type).toBe('string');
    expect(result.fields.port.type).toBe('number');
    expect(result.fields.debug.type).toBe('boolean');
    expect(result.fields.api_url.type).toBe('url');
    expect(result.fields.db_password.type).toBe('secret');
  });

  it('no infiere secret para keys que no coinciden con patrones', () => {
    const result = inferSchema({ username: 'admin' });
    expect(result.fields.username.type).toBe('string');
    expect(result.fields.username.secret).toBe(false);
  });
});
