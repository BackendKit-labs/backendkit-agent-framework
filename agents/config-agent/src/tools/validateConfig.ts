import { readVersion } from '../storage/versionedStore.js';
import { readSchema } from '../storage/schemaStore.js';
import { validateConfig as validate } from '../services/validator.js';
import { inferSchema } from '../services/inferer.js';
import { sanitizeAgentId } from '../shared/validation.js';

export interface ValidateConfigInput {
  agent_id: string
  version?: string
}

export interface ValidationCheck {
  key: string
  status: 'ok' | 'missing' | 'invalid_format' | 'expired'
  message?: string
}

export interface ValidateConfigOutput {
  agent_id: string
  version: string
  status: 'valid' | 'incomplete' | 'invalid'
  checks: ValidationCheck[]
  missingRequired: string[]
  warnings: string[]
  errors: string[]
  passed: number
  failed: number
}

export async function validateConfig(input: ValidateConfigInput): Promise<ValidateConfigOutput> {
  const agent_id = sanitizeAgentId(input.agent_id);
  const { version } = input;

  const configVersion = readVersion(agent_id, version || 'current');
  if (!configVersion) {
    throw new Error(`El agente '${agent_id}' no existe o no tiene configuración.`);
  }

  // Buscar schema registrado o inferir
  let schema = readSchema(agent_id);
  if (!schema) {
    schema = inferSchema(configVersion.config);
  }

  const result = validate(configVersion.config, schema);

  return {
    agent_id,
    version: configVersion.version,
    status: result.status,
    checks: result.checks,
    missingRequired: result.missingRequired,
    warnings: result.warnings,
    errors: result.errors,
    passed: result.passed,
    failed: result.failed,
  };
}
