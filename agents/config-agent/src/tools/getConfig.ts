import { readVersion } from '../storage/versionedStore.js';
import { readSecret } from '../storage/secretStore.js';
import { readSchema } from '../storage/schemaStore.js';
import { sanitizeAgentId } from '../shared/validation.js';

export interface GetConfigInput {
  agent_id: string
  key?: string
  version?: string
  includeSecrets?: boolean
}

export interface GetConfigOutput {
  agent_id: string
  version: string
  config: Record<string, any>
  secretsIncluded: boolean
  updatedAt: string
}

export async function getConfig(input: GetConfigInput): Promise<GetConfigOutput> {
  const agent_id = sanitizeAgentId(input.agent_id);
  const { key, version, includeSecrets } = input;

  const configVersion = readVersion(agent_id, version);
  if (!configVersion) {
    throw new Error(`El agente '${agent_id}' no existe o no tiene configuración.`);
  }

  const config = { ...configVersion.config };

  // Incluir secrets si se solicita
  if (includeSecrets) {
    const schema = readSchema(agent_id);
    if (schema?.fields) {
      for (const [fieldKey, fieldSchema] of Object.entries(schema.fields)) {
        if (fieldSchema.secret && config[fieldKey]) {
          const decrypted = readSecret(agent_id, fieldKey);
          if (decrypted) config[fieldKey] = decrypted;
        }
      }
    }
  }

  // Filtrar por key si se especifica
  if (key) {
    if (!(key in config)) {
      throw new Error(`La clave '${key}' no existe en la configuración de '${agent_id}'.`);
    }
    return {
      agent_id,
      version: configVersion.version,
      config: { [key]: config[key] },
      secretsIncluded: !!includeSecrets,
      updatedAt: configVersion.createdAt,
    };
  }

  return {
    agent_id,
    version: configVersion.version,
    config,
    secretsIncluded: !!includeSecrets,
    updatedAt: configVersion.createdAt,
  };
}
