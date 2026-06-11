import { cn } from '@/lib/utils';
import type { KanbanRun, KanbanColumn } from '@/hooks/useKanbanMonitor';
import { KanbanCard } from './KanbanCard';

// ── Column config ─────────────────────────────────────────────────────────────

interface ColumnDef {
  id: KanbanColumn;
  label: string;
  dot: string;
}

const COLUMNS: ColumnDef[] = [
  { id: 'pending', label: 'Pendiente',             dot: 'bg-zinc-400' },
  { id: 'running', label: 'En Proceso',             dot: 'bg-indigo-400 animate-pulse' },
  { id: 'waiting', label: 'Esperando Aprobación',  dot: 'bg-amber-400 animate-pulse' },
  { id: 'done',    label: 'Completado',             dot: 'bg-emerald-400' },
];

const headerColor: Record<KanbanColumn, string> = {
  pending: 'text-zinc-400',
  running: 'text-indigo-400',
  waiting: 'text-amber-400',
  done:    'text-emerald-400',
  error:   'text-red-400',
};

// ── Column ────────────────────────────────────────────────────────────────────

interface ColumnProps {
  def: ColumnDef;
  runs: KanbanRun[];
}

function Column({ def, runs }: ColumnProps) {
  // Show errors in the Completado column too, with a red sub-header
  const mainRuns = runs.filter(r => r.column === def.id);
  const errorRuns = def.id === 'done' ? runs.filter(r => r.column === 'error') : [];
  const total = mainRuns.length + errorRuns.length;

  return (
    <div className="flex flex-col min-h-0">
      {/* Column header */}
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <span className={cn('h-2 w-2 rounded-full shrink-0', def.dot)} />
        <span className={cn('text-xs font-semibold uppercase tracking-wider', headerColor[def.id])}>
          {def.label}
        </span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {total > 0 ? total : ''}
        </span>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2 overflow-y-auto flex-1">
        {mainRuns.map(run => <KanbanCard key={run.id} run={run} />)}

        {errorRuns.length > 0 && (
          <>
            {mainRuns.length > 0 && <hr className="border-red-900/30 my-1" />}
            {errorRuns.map(run => <KanbanCard key={run.id} run={run} />)}
          </>
        )}

        {total === 0 && (
          <div className="rounded-lg border border-dashed border-border/40 py-6 text-center text-xs text-muted-foreground/50">
            vacío
          </div>
        )}
      </div>
    </div>
  );
}

// ── Board ─────────────────────────────────────────────────────────────────────

interface KanbanBoardProps {
  runs: KanbanRun[];
}

export function KanbanBoard({ runs }: KanbanBoardProps) {
  return (
    <div className="grid grid-cols-4 gap-4 h-full p-4 overflow-hidden">
      {COLUMNS.map(col => (
        <Column key={col.id} def={col} runs={runs} />
      ))}
    </div>
  );
}
