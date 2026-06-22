import type { ConfigSchema, FieldSchema } from '../types/schema.js';

export function inferSchema(config: Record<string, any>): ConfigSchema {
  const fields: Record<string, FieldSchema> = {};

  for (const [key, value] of Object.entries(config)) {
    const field: FieldSchema = {
      type: 'string',
      required: true,
      secret: isSecretKey(key),
    };

    if (typeof value === 'number') {
      field.type = 'number';
    } else if (typeof value === 'boolean') {
      field.type = 'boolean';
    } else if (typeof value === 'string') {
      if (isUrl(value)) {
        field.type = 'url';
      } else if (isSecretKey(key)) {
        field.type = 'secret';
      }
    }

    fields[key] = field;
  }

  return { fields };
}

function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isSecretKey(key: string): boolean {
  const secretPatterns = ['token', 'secret', 'password', 'pass', 'key', 'api_key', 'apikey', 'private_key'];
  const lower = key.toLowerCase();
  return secretPatterns.some(p => lower.includes(p));
}
