import { writeSecret } from '../storage/secretStore.js';
import { readVersion, writeVersion } from '../storage/versionedStore.js';
import { sanitizeAgentId } from '../shared/validation.js';

export interface SetSecretInput {
  agent_id: string
  key: string
  value: string
  message?: string
  reload?: boolean
}

export interface SetSecretOutput {
  agent_id: string
  key: string
  status: 'encrypted'
  newVersion: string
  reloadTriggered: boolean
}

export async function setSecret(input: SetSecretInput): Promise<SetSecretOutput> {
  const agent_id = sanitizeAgentId(input.agent_id);
  const { key, value, message, reload } = input;

  if (!key) {
    throw new Error('Debes especificar una clave (key) para el secreto.');
  }

  if (!value) {
    throw new Error(`No me diste el valor para '${key}'. No puedo inventarlo.`);
  }

  // Guardar encriptado en secrets store
  writeSecret(agent_id, key, value);

  // Actualizar config para reflejar que el secreto existe
  const currentVersion = readVersion(agent_id, 'current');
  const currentConfig = currentVersion?.config || {};
  const newConfig = { ...currentConfig, [key]: '🔒 encriptado' };

  const changes = [{
    key,
    action: key in currentConfig ? 'updated' as const : 'added' as const,
    previousVersion: currentVersion?.version,
  }];

  const msg = message || `set secret ${key}`;
  const version = writeVersion(agent_id, newConfig, changes, msg);

  return {
    agent_id,
    key,
    status: 'encrypted',
    newVersion: version.version,
    reloadTriggered: !!reload,
  };
}
