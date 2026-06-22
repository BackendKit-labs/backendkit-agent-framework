import { readVersion, writeVersion } from '../storage/versionedStore.js';
import { mergeConfigs } from '../services/merger.js';
import { sanitizeAgentId } from '../shared/validation.js';

export interface ImportConfigInput {
  agent_id: string
  format: 'json' | 'env'
  content: string
  mode: 'merge' | 'overwrite' | 'dry-run'
  message?: string
  reload?: boolean
}

export interface ImportChange {
  key: string
  action: 'added' | 'updated' | 'deleted' | 'skipped'
  previousValue?: any
  newValue?: any
}

export interface ImportConfigOutput {
  agent_id: string
  newVersion?: string
  changes: ImportChange[]
  warnings: string[]
  errors: string[]
  summary: string
}

function parseContent(content: string, format: string): Record<string, any> {
  switch (format) {
    case 'json':
      try {
        return JSON.parse(content);
      } catch (e: any) {
        throw new Error(`Error al parsear JSON: ${e.message}`);
      }

    case 'env': {
      const result: Record<string, any> = {};
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;
        const key = trimmed.slice(0, eqIndex).trim();
        let value: any = trimmed.slice(eqIndex + 1).trim();
        // Intentar parsear números y booleanos
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        else if (/^\d+$/.test(value)) value = parseInt(value, 10);
        else if (/^\d+\.\d+$/.test(value)) value = parseFloat(value);
        // Remover comillas si están
        if (typeof value === 'string' && (value.startsWith('"') && value.endsWith('"'))) {
          value = value.slice(1, -1);
        }
        result[key] = value;
      }
      return result;
    }

    default:
      throw new Error(`Formato '${format}' no soportado. Usá json o env.`);
  }
}

export async function importConfig(input: ImportConfigInput): Promise<ImportConfigOutput> {
  const agent_id = sanitizeAgentId(input.agent_id);
  const { format, content, mode, message, reload } = input;

  if (!content) {
    throw new Error('No me diste contenido para importar. No puedo inventarlo.');
  }

  // Parsear contenido
  const parsed = parseContent(content, format);

  // Leer config actual
  const currentVersion = readVersion(agent_id, 'current');
  const currentConfig = currentVersion?.config || {};

  // Mergear
  const mergeResult = mergeConfigs(currentConfig, parsed, mode);

  // Si no es dry-run, persistir
  let newVersion: string | undefined;
  if (mode !== 'dry-run') {
    const msg = message || `import ${format} (${mode})`;
    const version = writeVersion(agent_id, mergeResult.config, mergeResult.changes.map(c => ({
      key: c.key,
      action: c.action === 'skipped' ? 'added' as const : (c.action === 'deleted' ? 'removed' as const : c.action as 'added' | 'updated' | 'removed'),
    })), msg);
    newVersion = version.version;
  }

  return {
    agent_id,
    newVersion,
    changes: mergeResult.changes,
    warnings: mergeResult.warnings,
    errors: mergeResult.errors,
    summary: mergeResult.summary,
  };
}
