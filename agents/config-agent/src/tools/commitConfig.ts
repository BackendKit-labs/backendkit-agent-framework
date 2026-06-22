import { readVersion, writeVersion, getCurrentVersionId } from '../storage/versionedStore.js';
import { createHash } from 'crypto';
import { sanitizeAgentId } from '../shared/validation.js';

export interface CommitConfigInput {
  agent_id: string
  message: string
}

export interface CommitChange {
  key: string
  action: string
}

export interface CommitConfigOutput {
  agent_id: string
  version: string
  changesSinceLastCommit: CommitChange[]
  commitHash: string
}

export async function commitConfig(input: CommitConfigInput): Promise<CommitConfigOutput> {
  const agent_id = sanitizeAgentId(input.agent_id);
  const { message } = input;

  if (!message) {
    throw new Error('Debes proporcionar un mensaje para el commit.');
  }

  const currentVersion = readVersion(agent_id, 'current');
  if (!currentVersion) {
    throw new Error(`El agente '${agent_id}' no tiene configuración para committear.`);
  }

  // Calcular cambios desde el último commit
  const changesSinceLastCommit: CommitChange[] = currentVersion.changes.map(c => ({
    key: c.key,
    action: c.action,
  }));

  // Si no hubo cambios, no crear nuevo snapshot
  if (changesSinceLastCommit.length === 0) {
    return {
      agent_id,
      version: currentVersion.version,
      changesSinceLastCommit: [],
      commitHash: currentVersion.checksum,
    };
  }

  // Crear snapshot versionado
  const version = writeVersion(agent_id, currentVersion.config, currentVersion.changes, message);

  // Calcular SHA256 del archivo como commit hash
  const commitHash = createHash('sha256')
    .update(JSON.stringify(version))
    .digest('hex');

  return {
    agent_id,
    version: version.version,
    changesSinceLastCommit,
    commitHash,
  };
}
