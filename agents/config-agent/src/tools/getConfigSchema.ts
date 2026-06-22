import { readSchema } from '../storage/schemaStore.js';
import { inferSchema } from '../services/inferer.js';
import { readVersion } from '../storage/versionedStore.js';
import { sanitizeAgentId } from '../shared/validation.js';

export interface GetConfigSchemaInput {
  agent_id: string
}

export interface ConfigFieldSchema {
  type: string
  required: boolean
  default?: any
  description?: string
  placeholder?: string
  min?: number
  max?: number
  options?: string[]
  pattern?: string
  secret: boolean
}

export interface GetConfigSchemaOutput {
  agent_id: string
  hasSchema: boolean
  schema?: {
    fields: Record<string, ConfigFieldSchema>
    groups?: { title: string; fields: string[] }[]
  }
}

export async function getConfigSchema(input: GetConfigSchemaInput): Promise<GetConfigSchemaOutput> {
  const agent_id = sanitizeAgentId(input.agent_id);

  // 1. Buscar schema registrado
  const registered = readSchema(agent_id);
  if (registered) {
    return {
      agent_id,
      hasSchema: true,
      schema: registered as any,
    };
  }

  // 2. Intentar inferir desde config actual
  const configVersion = readVersion(agent_id, 'current');
  if (configVersion) {
    const inferred = inferSchema(configVersion.config);
    return {
      agent_id,
      hasSchema: true,
      schema: inferred as any,
    };
  }

  // 3. No hay schema ni config
  return {
    agent_id,
    hasSchema: false,
  };
}
