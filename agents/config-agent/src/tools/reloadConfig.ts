import { writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { sanitizeAgentId } from '../shared/validation.js';

const DATA_DIR = process.env.CONFIG_DATA_DIR || resolve(homedir(), '.backendkit', 'config');

export interface ReloadConfigInput {
  agent_id: string
}

export interface ReloadConfigOutput {
  agent_id: string
  status: 'reloaded' | 'not_found' | 'not_supported'
  message: string
}

export async function reloadConfig(input: ReloadConfigInput): Promise<ReloadConfigOutput> {
  const agentId = sanitizeAgentId(input.agent_id);
  const agentDir = resolve(DATA_DIR, 'agents', agentId);

  if (!existsSync(agentDir)) {
    return {
      agent_id: agentId,
      status: 'not_found',
      message: `El agente '${agentId}' no existe en ${agentDir}.`,
    };
  }

  try {
    const reloadFile = resolve(agentDir, '.reload');
    const content = JSON.stringify({
      triggeredAt: new Date().toISOString(),
      agent_id: agentId,
      source: 'config-agent',
    }, null, 2);
    writeFileSync(reloadFile, content, 'utf-8');

    return {
      agent_id: agentId,
      status: 'reloaded',
      message: `Señal de recarga enviada a '${agentId}' vía ${reloadFile}. El agente detectará el cambio en su próximo ciclo.`,
    };
  } catch (err: any) {
    return {
      agent_id: agentId,
      status: 'not_supported',
      message: `No se pudo enviar señal de recarga a '${agentId}': ${err.message}. La recarga debe hacerse manualmente.`,
    };
  }
}
