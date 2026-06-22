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

export interface EnvDetectionResult {
  detected: number
  new: EnvDetected[]
  updated: EnvUpdated[]
  ignored: EnvIgnored[]
  conflicts: EnvConflict[]
}

export function detectEnvVars(
  knownKeys: string[],
  prefix?: string,
  currentConfig?: Record<string, any>
): EnvDetectionResult {
  const result: EnvDetectionResult = {
    detected: 0,
    new: [],
    updated: [],
    ignored: [],
    conflicts: [],
  };

  const envKeys = Object.keys(process.env);

  // Filtrar por prefijo o por keys conocidas
  const relevantKeys = envKeys.filter(key => {
    if (prefix && key.startsWith(prefix)) return true;
    if (knownKeys.includes(key)) return true;
    return false;
  });

  for (const key of relevantKeys) {
    const envValue = process.env[key] || '';

    // Ignorar valores vacíos
    if (!envValue) {
      result.ignored.push({ key, reason: 'Valor vacío en env' });
      continue;
    }

    // Ignorar valores default conocidos
    if (envValue.startsWith('your-') || envValue === 'changeme' || envValue === '') {
      result.ignored.push({ key, reason: 'Valor default no configurado' });
      continue;
    }

    result.detected++;

    if (currentConfig && key in currentConfig) {
      const configValue = String(currentConfig[key]);
      if (configValue !== envValue) {
        // Conflicto: env var difiere de config existente
        result.conflicts.push({
          key,
          envValue,
          configValue,
          chosen: 'env', // La env var tiene prioridad
        });
        result.updated.push({ key, from: configValue, to: envValue });
      }
    } else {
      result.new.push({ key, value: envValue });
    }
  }

  return result;
}
