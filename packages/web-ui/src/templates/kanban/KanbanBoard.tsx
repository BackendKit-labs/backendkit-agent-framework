import { cn } from '@/lib/utils';
import type { KanbanRun, KanbanColumn } from '@/hooks/useKanbanMonitor';
import { KanbanCard } from './KanbanCard';

interface ColumnDef {
  id: KanbanColumn;
  label: string;
  dotClass: string;
  labelClass: string;
}

const COLUMNS: ColumnDef[] = [
  { id: 'pending', label: 'Pendiente',            dotClass: 'bg-zinc-400',                          labelClass: 'text-zinc-400' },
  { id: 'running', label: 'En Proceso',            dotClass: 'bg-indigo-400 animate-pulse',          labelClass: 'text-indigo-400' },
  { id: 'waiting', label: 'Esperando Aprobación', dotClass: 'bg-amber-400 animate-pulse',           labelClass: 'text-amber-400' },
  { id: 'done',    label: 'Completado',            dotClass: 'bg-emerald-400',                       labelClass: 'text-emerald-400' },
];

interface SectionProps {
  def: ColumnDef;
  runs: KanbanRun[];
}

function Section({ def, runs }: SectionProps) {
  const mainRuns  = runs.filter(r => r.column === def.id);
  const errorRuns = def.id === 'done' ? runs.filter(r => r.column === 'error') : [];
  const total     = mainRuns.length + errorRuns.length;

  return (
    <div className={cn(
      'rounded-xl border transition-colors',
      total > 0 ? 'border-border' : 'border-border/40',
    )}>
      {/* Section header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40">
        <span className={cn('h-2 w-2 rounded-full shrink-0', def.dotClass)} />
        <span className={cn('text-xs font-semibold uppercase tracking-wider', def.labelClass)}>
          {def.label}
        </span>
        {total > 0 && (
          <span className="ml-1 text-xs text-muted-foreground tabular-nums">
            ({total})
          </span>
        )}
      </div>

      {/* Cards */}
      <div className="p-3">
        {total === 0 ? (
          <p className="text-center text-xs text-muted-foreground/40 py-2">vacío</p>
        ) : (
          <div className="flex flex-col gap-2">
            {mainRuns.map(run => <KanbanCard key={run.id} run={run} />)}
            {errorRuns.map(run => <KanbanCard key={run.id} run={run} />)}
          </div>
        )}
      </div>
    </div>
  );
}

interface KanbanBoardProps {
  runs: KanbanRun[];
}

export function KanbanBoard({ runs }: KanbanBoardProps) {
  return (
    <div className="flex flex-col gap-3 p-4 overflow-y-auto h-full">
      {COLUMNS.map(col => (
        <Section key={col.id} def={col} runs={runs} />
      ))}
    </div>
  );
}
