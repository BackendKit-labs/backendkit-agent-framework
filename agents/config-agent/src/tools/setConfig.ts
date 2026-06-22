import { readVersion, writeVersion } from '../storage/versionedStore.js';
import { readSecrets } from '../storage/secretStore.js';
import { readSchema } from '../storage/schemaStore.js';
import { sanitizeAgentId } from '../shared/validation.js';
import { validateConfig as validate } from '../services/validator.js';

export interface SetConfigInput {
  agent_id: string
  key: string
  value?: any
  message?: string
  reload?: boolean
}

export interface SetConfigOutput {
  agent_id: string
  key: string
  previousValue: any
  newValue: any
  newVersion: string
  reloadTriggered: boolean
}

export async function setConfig(input: SetConfigInput): Promise<SetConfigOutput> {
  const agent_id = sanitizeAgentId(input.agent_id);
  const { key, value, message, reload } = input;

  if (!key) {
    throw new Error('Debes especificar una clave (key) para configurar.');
  }

  if (value === undefined || value === null) {
    throw new Error(`No me diste el valor para '${key}'. No puedo inventarlo.`);
  }

  // RN-06: Verificar si la key es un secreto conocido
  const schema = readSchema(agent_id);
  if (schema?.fields?.[key]?.secret) {
    throw new Error(`'${key}' es un secreto. Usá set_secret en vez de set_config.`);
  }

  // Leer versión actual
  const currentVersion = readVersion(agent_id, 'current');
  const currentConfig = currentVersion?.config || {};

  // Verificar si la key existe en secrets store
  const secrets = readSecrets(agent_id);
  if (key in secrets) {
    throw new Error(`'${key}' es un secreto almacenado. Usá set_secret para actualizarlo.`);
  }

  // H10: Validar el nuevo valor contra el schema si existe
  if (schema?.fields?.[key]) {
    const validation = validate({ [key]: value }, { fields: { [key]: schema.fields[key] } });
    if (validation.failed > 0) {
      const errors = validation.errors.join('; ');
      throw new Error(`El valor para '${key}' no pasa la validación del schema: ${errors}`);
    }
  }

  const previousValue = currentConfig[key];
  const newConfig = { ...currentConfig, [key]: value };

  const changes = [{
    key,
    action: key in currentConfig ? 'updated' as const : 'added' as const,
    previousVersion: currentVersion?.version,
  }];

  const msg = message || `update ${key}`;
  const version = writeVersion(agent_id, newConfig, changes, msg);

  return {
    agent_id,
    key,
    previousValue,
    newValue: value,
    newVersion: version.version,
    reloadTriggered: !!reload,
  };
}
