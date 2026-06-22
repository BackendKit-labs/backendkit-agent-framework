import type { ConfigSchema, FieldSchema } from '../types/schema.js';

export interface ValidationCheck {
  key: string
  status: 'ok' | 'missing' | 'invalid_format' | 'expired'
  message?: string
}

export interface ValidationResult {
  status: 'valid' | 'incomplete' | 'invalid'
  checks: ValidationCheck[]
  missingRequired: string[]
  warnings: string[]
  errors: string[]
  passed: number
  failed: number
}

function validateField(value: any, fieldSchema: FieldSchema, key: string): ValidationCheck {
  // Campo requerido ausente
  if (value === undefined || value === null || value === '') {
    if (fieldSchema.required) {
      return { key, status: 'missing', message: `Campo requerido '${key}' no está configurado` };
    }
    return { key, status: 'ok' };
  }

  // Validar tipo
  switch (fieldSchema.type) {
    case 'string':
      if (typeof value !== 'string') {
        return { key, status: 'invalid_format', message: `'${key}' debe ser un string` };
      }
      if (fieldSchema.pattern && !new RegExp(fieldSchema.pattern).test(value)) {
        return { key, status: 'invalid_format', message: `'${key}' no coincide con el patrón requerido` };
      }
      break;

    case 'number':
      if (typeof value !== 'number' || isNaN(value)) {
        return { key, status: 'invalid_format', message: `'${key}' debe ser un número` };
      }
      if (fieldSchema.min !== undefined && value < fieldSchema.min) {
        return { key, status: 'invalid_format', message: `'${key}' debe ser >= ${fieldSchema.min}` };
      }
      if (fieldSchema.max !== undefined && value > fieldSchema.max) {
        return { key, status: 'invalid_format', message: `'${key}' debe ser <= ${fieldSchema.max}` };
      }
      break;

    case 'boolean':
      if (typeof value !== 'boolean') {
        return { key, status: 'invalid_format', message: `'${key}' debe ser true o false` };
      }
      break;

    case 'url':
      if (typeof value !== 'string') {
        return { key, status: 'invalid_format', message: `'${key}' debe ser una URL` };
      }
      try {
        new URL(value);
      } catch {
        return { key, status: 'invalid_format', message: `'${key}' no es una URL válida` };
      }
      break;

    case 'select':
      if (!fieldSchema.options?.includes(value)) {
        return { key, status: 'invalid_format', message: `'${key}' debe ser uno de: ${fieldSchema.options?.join(', ')}` };
      }
      break;

    case 'secret':
      if (typeof value !== 'string' || value.length < 4) {
        return { key, status: 'invalid_format', message: `'${key}' debe ser un secreto válido (mín. 4 caracteres)` };
      }
      break;
  }

  return { key, status: 'ok' };
}

function inferBasicType(value: any): string {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') {
    try { new URL(value); return 'url'; } catch { /* not a url */ }
    return 'string';
  }
  return 'string';
}

export function validateConfig(config: Record<string, any>, schema?: ConfigSchema | null): ValidationResult {
  const checks: ValidationCheck[] = [];
  const missingRequired: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  if (schema && schema.fields) {
    // Validar contra schema
    for (const [key, fieldSchema] of Object.entries(schema.fields)) {
      const check = validateField(config[key], fieldSchema, key);
      checks.push(check);
      if (check.status === 'missing') missingRequired.push(key);
      if (check.status === 'invalid_format') errors.push(check.message || `'${key}' tiene formato inválido`);
    }

    // Detectar keys en config que no están en schema
    for (const key of Object.keys(config)) {
      if (!schema.fields[key]) {
        warnings.push(`'${key}' no está definido en el schema`);
      }
    }
  } else {
    // Sin schema: validar solo que no estén vacíos
    for (const [key, value] of Object.entries(config)) {
      if (value === undefined || value === null || value === '') {
        checks.push({ key, status: 'missing', message: `'${key}' está vacío` });
        missingRequired.push(key);
      } else {
        checks.push({ key, status: 'ok' });
      }
    }
  }

  const passed = checks.filter(c => c.status === 'ok').length;
  const failed = checks.filter(c => c.status !== 'ok').length;

  let status: 'valid' | 'incomplete' | 'invalid';
  if (failed === 0) {
    status = missingRequired.length > 0 ? 'incomplete' : 'valid';
  } else {
    status = 'invalid';
  }

  return { status, checks, missingRequired, warnings, errors, passed, failed };
}
