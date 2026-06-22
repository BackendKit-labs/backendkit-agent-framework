import { readVersion, writeVersion } from '../storage/versionedStore.js';
import { readSchema } from '../storage/schemaStore.js';
import { detectEnvVars } from '../services/envDetector.js';
import { sanitizeAgentId } from '../shared/validation.js';

export interface DetectEnvInput {
  agent_id: string
  prefix?: string
  save?: boolean
  mode?: 'merge' | 'overwrite'
}

export interface EnvDetected {
  key: string
  value: string
}

export interface EnvUpdated {
  key: string
  from: string
  to: string
}

export interface EnvIgnored {
  key: string
  reason: string
}

export interface EnvConflict {
  key: string
  envValue: string
  configValue: string
  chosen: 'env' | 'config'
}

export interface DetectEnvOutput {
  agent_id: string
  detected: number
  new: EnvDetected[]
  updated: EnvUpdated[]
  ignored: EnvIgnored[]
  conflicts: EnvConflict[]
  saved: boolean
  newVersion?: string
}

export async function detectEnv(input: DetectEnvInput): Promise<DetectEnvOutput> {
  const agent_id = sanitizeAgentId(input.agent_id);
  const { prefix, save = true, mode = 'merge' } = input;

  // Obtener keys conocidas del agente (desde schema o config actual)
  const schema = readSchema(agent_id);
  const knownKeys = schema?.fields ? Object.keys(schema.fields) : [];

  // Leer config actual
  const currentVersion = readVersion(agent_id, 'current');
  const currentConfig = currentVersion?.config || {};

  // Detectar env vars
  const detection = detectEnvVars(knownKeys, prefix, currentConfig);

  // Guardar si se solicita y hay cambios
  let newVersion: string | undefined;
  if (save && (detection.new.length > 0 || detection.updated.length > 0)) {
    const newConfig = { ...currentConfig };

    // Aplicar cambios (prioridad a env var)
    for (const item of detection.new) {
      newConfig[item.key] = item.value;
    }
    for (const item of detection.updated) {
      newConfig[item.key] = item.to;
    }

    const changes = [
      ...detection.new.map(k => ({ key: k.key, action: 'added' as const })),
      ...detection.updated.map(k => ({ key: k.key, action: 'updated' as const })),
    ];

    const msg = `detect env (${detection.detected} vars)`;
    const version = writeVersion(agent_id, newConfig, changes, msg);
    newVersion = version.version;
  }

  return {
    agent_id,
    detected: detection.detected,
    new: detection.new,
    updated: detection.updated,
    ignored: detection.ignored,
    conflicts: detection.conflicts,
    saved: save && !!newVersion,
    newVersion,
  };
}
