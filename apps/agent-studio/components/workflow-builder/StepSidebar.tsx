'use client';

import { useState, useEffect } from 'react';
import { X, Trash2, ChevronDown } from 'lucide-react';
import { cn } from '@/components/ui';
import type { WorkflowStep, Deployable } from '@/lib/director';

interface Props {
  step: WorkflowStep;
  deployables: Deployable[];
  onUpdate: (patch: Partial<Pick<WorkflowStep, 'deployableId' | 'config'>>) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function StepSidebar({ step, deployables, onUpdate, onDelete, onClose }: Props) {
  const [configText, setConfigText] = useState(
    step.config ? JSON.stringify(step.config, null, 2) : '{}',
  );
  const [configError, setConfigError] = useState('');

  useEffect(() => {
    setConfigText(step.config ? JSON.stringify(step.config, null, 2) : '{}');
    setConfigError('');
  }, [step.id]);

  function handleConfigBlur() {
    try {
      const parsed = JSON.parse(configText);
      setConfigError('');
      onUpdate({ config: parsed });
    } catch {
      setConfigError('JSON inválido');
    }
  }

  return (
    <aside className="flex w-72 flex-col border-l border-border bg-card">
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <span className="text-sm font-medium text-foreground">
          Paso {step.order}
        </span>
        <button
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col gap-5 overflow-y-auto p-4">
        {/* Deployable selector */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Deployable
          </label>
          <div className="relative">
            <select
              value={step.deployableId ?? ''}
              onChange={e => onUpdate({ deployableId: e.target.value || undefined })}
              className={cn(
                'w-full appearance-none rounded-lg border border-border bg-secondary',
                'px-3 py-2 pr-8 text-sm text-foreground',
                'focus:outline-none focus:ring-2 focus:ring-primary/40',
              )}
            >
              <option value="">— Sin deployable —</option>
              {deployables.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.type})
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>

        {/* Config JSON */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Configuración (JSON)
          </label>
          <textarea
            value={configText}
            onChange={e => { setConfigText(e.target.value); setConfigError(''); }}
            onBlur={handleConfigBlur}
            rows={10}
            spellCheck={false}
            className={cn(
              'w-full rounded-lg border bg-secondary px-3 py-2',
              'font-mono text-xs text-foreground resize-none',
              'focus:outline-none focus:ring-2 focus:ring-primary/40',
              configError ? 'border-red-500/50' : 'border-border',
            )}
          />
          {configError && (
            <p className="text-xs text-red-400">{configError}</p>
          )}
        </div>

        {/* Delete step */}
        <button
          onClick={() => { if (confirm(`¿Eliminar paso ${step.order}?`)) onDelete(); }}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-red-800/30 bg-red-950/20 px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-950/40 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Eliminar paso
        </button>
      </div>
    </aside>
  );
}
