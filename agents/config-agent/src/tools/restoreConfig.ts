import { readVersion, writeVersion } from '../storage/versionedStore.js';
import { sanitizeAgentId } from '../shared/validation.js';

export interface RestoreConfigInput {
  agent_id: string
  version: string
  reload?: boolean
}

export interface RestoreConfigOutput {
  agent_id: string
  restoredVersion: string
  newVersion: string
  changes: { key: string; from: any; to: any }[]
  reloadTriggered: boolean
}

export async function restoreConfig(input: RestoreConfigInput): Promise<RestoreConfigOutput> {
  const agent_id = sanitizeAgentId(input.agent_id);
  const { version, reload } = input;

  if (!version) {
    throw new Error('Debes especificar qué versión restaurar.');
  }

  // Leer la versión a restaurar
  const sourceVersion = readVersion(agent_id, version);
  if (!sourceVersion) {
    throw new Error(`La versión '${version}' no existe para el agente '${agent_id}'.`);
  }

  // Leer versión actual para calcular cambios
  const currentVersion = readVersion(agent_id, 'current');
  const currentConfig = currentVersion?.config || {};

  // Calcular cambios entre current y la versión restaurada
  const changes: { key: string; from: any; to: any }[] = [];
  const allKeys = new Set([...Object.keys(currentConfig), ...Object.keys(sourceVersion.config)]);
  for (const key of allKeys) {
    const fromVal = currentConfig[key];
    const toVal = sourceVersion.config[key];
    if (JSON.stringify(fromVal) !== JSON.stringify(toVal)) {
      changes.push({ key, from: fromVal, to: toVal });
    }
  }

  // Crear nueva versión con los valores de la restaurada (no muta la original)
  const msg = `restore from ${version}`;
  const newVer = writeVersion(agent_id, sourceVersion.config, changes.map(c => ({
    key: c.key,
    action: 'updated' as const,
  })), msg);

  return {
    agent_id,
    restoredVersion: version,
    newVersion: newVer.version,
    changes,
    reloadTriggered: !!reload,
  };
}
