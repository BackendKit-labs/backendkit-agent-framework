'use client';

import { useState, useEffect, useCallback } from 'react';
import { History, RefreshCw, Loader2, AlertCircle, CheckCircle2, XCircle, Clock, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAllRuns, type WorkflowRun } from '@/lib/api';

// ── Helpers ───────────────────────────────────────────────────────────────────

type RunStatus = WorkflowRun['status'];
type Filter = 'all' | RunStatus;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all',       label: 'Todos' },
  { key: 'running',   label: 'Corriendo' },
  { key: 'pending',   label: 'Pendiente' },
  { key: 'completed', label: 'Completado' },
  { key: 'failed',    label: 'Fallido' },
  { key: 'cancelled', label: 'Cancelado' },
];

function StatusIcon({ status }: { status: RunStatus }) {
  switch (status) {
    case 'running':   return <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />;
    case 'pending':   return <Clock className="w-3.5 h-3.5 text-amber-400" />;
    case 'completed': return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
    case 'failed':    return <XCircle className="w-3.5 h-3.5 text-red-400" />;
    case 'cancelled': return <Circle className="w-3.5 h-3.5 text-zinc-400" />;
    default:          return null;
  }
}

function statusLabel(status: RunStatus): string {
  switch (status) {
    case 'running':   return 'corriendo';
    case 'pending':   return 'pendiente';
    case 'completed': return 'completado';
    case 'failed':    return 'fallido';
    case 'cancelled': return 'cancelado';
    default:          return status;
  }
}

function statusColor(status: RunStatus): string {
  switch (status) {
    case 'running':   return 'text-blue-400';
    case 'pending':   return 'text-amber-400';
    case 'completed': return 'text-emerald-400';
    case 'failed':    return 'text-red-400';
    case 'cancelled': return 'text-zinc-400';
    default:          return 'text-zinc-400';
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function duration(run: WorkflowRun): string {
  if (!run.startedAt) return '—';
  const end = run.completedAt ? new Date(run.completedAt) : new Date();
  const ms = end.getTime() - new Date(run.startedAt).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

// ── Run row ───────────────────────────────────────────────────────────────────

function RunRow({ run }: { run: WorkflowRun }) {
  return (
    <tr className="border-b border-border hover:bg-accent/30 transition-colors group">
      <td className="px-4 py-3 text-sm text-foreground font-medium">
        {run.workflow?.name ?? <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-4 py-3">
        <div className={cn('flex items-center gap-1.5 text-xs font-medium', statusColor(run.status))}>
          <StatusIcon status={run.status} />
          {statusLabel(run.status)}
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
        {shortId(run.id)}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {formatDate(run.startedAt ?? run.createdAt)}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
        {duration(run)}
      </td>
      <td className="px-4 py-3 text-xs text-red-400 max-w-xs">
        {run.error ? (
          <span className="truncate block" title={run.error}>{run.error}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RunsPage() {
  const [runs,    setRuns]    = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [filter,  setFilter]  = useState<Filter>('all');

  const fetchRuns = useCallback(async () => {
    try {
      const data = await getAllRuns(500);
      setRuns(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar historial');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
    const interval = setInterval(fetchRuns, 10_000);
    return () => clearInterval(interval);
  }, [fetchRuns]);

  const filtered = filter === 'all' ? runs : runs.filter(r => r.status === filter);

  const counts = runs.reduce<Partial<Record<Filter, number>>>(
    (acc, r) => ({ ...acc, [r.status]: (acc[r.status as Filter] ?? 0) + 1 }),
    {}
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Cargando historial...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <History className="w-4 h-4 text-primary" />
          <span>Historial de Runs</span>
          <span className="text-xs text-muted-foreground font-normal">({runs.length} total)</span>
        </div>
        <button
          onClick={fetchRuns}
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border shrink-0 overflow-x-auto">
        {FILTERS.map(f => {
          const count = f.key === 'all' ? runs.length : counts[f.key] ?? 0;
          if (f.key !== 'all' && count === 0) return null;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs transition-colors whitespace-nowrap',
                filter === f.key
                  ? 'bg-accent text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
            >
              {f.label}
              <span className={cn(
                'text-[10px] px-1 rounded-full',
                filter === f.key ? 'bg-primary/20 text-primary' : 'bg-accent text-muted-foreground'
              )}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="mx-4 mt-3 flex items-center gap-2 text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 shrink-0">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <History className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">Sin runs {filter !== 'all' ? `con estado "${filter}"` : ''}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background border-b border-border">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Workflow</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Estado</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Run ID</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Inicio</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Duración</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Error</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(run => <RunRow key={run.id} run={run} />)}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
