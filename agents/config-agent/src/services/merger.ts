export interface MergeChange {
  key: string
  action: 'added' | 'updated' | 'deleted' | 'skipped'
  previousValue?: any
  newValue?: any
}

export interface MergeResult {
  config: Record<string, any>
  changes: MergeChange[]
  warnings: string[]
  errors: string[]
  summary: string
}

export function mergeConfigs(
  current: Record<string, any>,
  incoming: Record<string, any>,
  mode: 'merge' | 'overwrite' | 'dry-run'
): MergeResult {
  const changes: MergeChange[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  if (mode === 'overwrite') {
    // Reemplazar todo: lo que no está en incoming se borra
    for (const key of Object.keys(current)) {
      if (!(key in incoming)) {
        changes.push({ key, action: 'deleted', previousValue: current[key] });
      }
    }
    for (const [key, value] of Object.entries(incoming)) {
      if (key in current && JSON.stringify(current[key]) !== JSON.stringify(value)) {
        changes.push({ key, action: 'updated', previousValue: current[key], newValue: value });
      } else if (!(key in current)) {
        changes.push({ key, action: 'added', newValue: value });
      }
    }
  } else {
    // merge: combina, no borra nada
    for (const [key, value] of Object.entries(incoming)) {
      if (key in current) {
        if (JSON.stringify(current[key]) !== JSON.stringify(value)) {
          changes.push({ key, action: 'updated', previousValue: current[key], newValue: value });
        } else {
          changes.push({ key, action: 'skipped', previousValue: current[key] });
        }
      } else {
        changes.push({ key, action: 'added', newValue: value });
      }
    }
  }

  // Construir config resultante (solo si no es dry-run)
  let config: Record<string, any>;
  if (mode === 'dry-run') {
    config = {};
  } else if (mode === 'overwrite') {
    config = { ...incoming };
  } else {
    config = { ...current, ...incoming };
  }

  const added = changes.filter(c => c.action === 'added').length;
  const updated = changes.filter(c => c.action === 'updated').length;
  const deleted = changes.filter(c => c.action === 'deleted').length;
  const skipped = changes.filter(c => c.action === 'skipped').length;
  const summary = `${changes.length} cambios: ${added} agregados, ${updated} actualizados, ${deleted} eliminados, ${skipped} sin cambios`;

  return { config, changes, warnings, errors, summary };
}
