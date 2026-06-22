export interface DiffChange {
  key: string
  type: 'added' | 'removed' | 'updated'
  from?: any
  to?: any
}

export interface DiffResult {
  summary: string
  changes: DiffChange[]
  textDiff?: string
}

export function diffConfigs(
  configA: Record<string, any>,
  configB: Record<string, any>,
  format: 'structured' | 'text' = 'structured'
): DiffResult {
  const changes: DiffChange[] = [];
  const allKeys = new Set([...Object.keys(configA), ...Object.keys(configB)]);

  for (const key of allKeys) {
    const inA = key in configA;
    const inB = key in configB;

    if (inA && !inB) {
      changes.push({ key, type: 'removed', from: configA[key] });
    } else if (!inA && inB) {
      changes.push({ key, type: 'added', to: configB[key] });
    } else if (JSON.stringify(configA[key]) !== JSON.stringify(configB[key])) {
      changes.push({ key, type: 'updated', from: configA[key], to: configB[key] });
    }
  }

  const added = changes.filter(c => c.type === 'added').length;
  const removed = changes.filter(c => c.type === 'removed').length;
  const updated = changes.filter(c => c.type === 'updated').length;
  const summary = `${changes.length} cambios: ${added} agregados, ${updated} modificados, ${removed} eliminados`;

  let textDiff: string | undefined;
  if (format === 'text') {
    textDiff = changes.map(c => {
      switch (c.type) {
        case 'added': return `+${c.key}: ${JSON.stringify(c.to)}`;
        case 'removed': return `-${c.key}: ${JSON.stringify(c.from)}`;
        case 'updated': return `~${c.key}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`;
      }
    }).join('\n');
  }

  return { summary, changes, textDiff };
}
