import { readVersion, listVersions, getCurrentVersionId } from '../storage/versionedStore.js';
import { readSecrets } from '../storage/secretStore.js';
import { readSchema } from '../storage/schemaStore.js';
import { validateConfig } from '../services/validator.js';
import { sanitizeAgentId } from '../shared/validation.js';

export interface ListConfigsInput {
  agent_id: string
}

export interface ConfigEntryMeta {
  value: any
  type: 'config' | 'secret'
  updatedAt: string
  updatedInVersion: string
  validated: boolean
}

export interface ListConfigsOutput {
  agent_id: string
  currentVersion: string
  totalVersions: number
  config: Record<string, ConfigEntryMeta>
  missingRequired: string[]
  outdatedSecrets: string[]
}

export async function listConfigs(input: ListConfigsInput): Promise<ListConfigsOutput> {
  const agent_id = sanitizeAgentId(input.agent_id);

  const currentVersion = getCurrentVersionId(agent_id);
  if (!currentVersion) {
    throw new Error(`El agente '${agent_id}' no existe o no tiene configuración.`);
  }

  const configVersion = readVersion(agent_id, currentVersion);
  if (!configVersion) {
    throw new Error(`No se pudo leer la configuración de '${agent_id}'.`);
  }

  const versions = listVersions(agent_id);
  const schema = readSchema(agent_id);
  const secrets = readSecrets(agent_id);

  // Validar config
  const validation = validateConfig(configVersion.config, schema);

  // Construir metadata por key
  const config: Record<string, ConfigEntryMeta> = {};
  for (const [key, value] of Object.entries(configVersion.config)) {
    const isSecret = key in secrets || schema?.fields?.[key]?.secret === true;
    config[key] = {
      value,
      type: isSecret ? 'secret' : 'config',
      updatedAt: configVersion.createdAt,
      updatedInVersion: currentVersion,
      validated: validation.checks.find(c => c.key === key)?.status === 'ok',
    };
  }

  // Detectar secrets desactualizados (nunca actualizados)
  const outdatedSecrets: string[] = [];
  if (schema?.fields) {
    for (const [key, fieldSchema] of Object.entries(schema.fields)) {
      if (fieldSchema.secret && !(key in secrets)) {
        outdatedSecrets.push(key);
      }
    }
  }

  return {
    agent_id,
    currentVersion,
    totalVersions: versions.length,
    config,
    missingRequired: validation.missingRequired,
    outdatedSecrets,
  };
}
