import { readVersion } from '../storage/versionedStore.js';
import { diffConfigs } from '../services/differ.js';
import { sanitizeAgentId } from '../shared/validation.js';

export interface DiffConfigInput {
  agent_id: string
  version_a: string
  version_b: string
  format?: 'structured' | 'text'
}

export interface DiffConfigOutput {
  agent_id: string
  version_a: string
  version_b: string
  summary: string
  changes: { key: string; type: 'added' | 'removed' | 'updated'; from?: any; to?: any }[]
  textDiff?: string
}

export async function diffConfig(input: DiffConfigInput): Promise<DiffConfigOutput> {
  const agent_id = sanitizeAgentId(input.agent_id);
  const { version_a, version_b, format } = input;

  const configA = readVersion(agent_id, version_a);
  if (!configA) {
    throw new Error(`La versión '${version_a}' no existe para el agente '${agent_id}'.`);
  }

  const configB = readVersion(agent_id, version_b);
  if (!configB) {
    throw new Error(`La versión '${version_b}' no existe para el agente '${agent_id}'.`);
  }

  const result = diffConfigs(configA.config, configB.config, format || 'structured');

  return {
    agent_id,
    version_a,
    version_b,
    summary: result.summary,
    changes: result.changes,
    textDiff: result.textDiff,
  };
}
