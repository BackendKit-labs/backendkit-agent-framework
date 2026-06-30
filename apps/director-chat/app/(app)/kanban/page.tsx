'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Clock, CheckCircle2, XCircle, Loader2, Kanban, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAllRuns, type WorkflowRun } from '@/lib/api';

// ── Helpers ───────────────────────────────────────────────────────────────────

type RunStatus = WorkflowRun['status'];

const COLUMNS: { status: RunStatus | RunStatus[]; label: string; color: string; icon: React.ReactNode }[] = [
  { status: 'pending',   label: 'Pendiente',   color: 'text-amber-400',   icon: <Clock className="w-4 h-4" /> },
  { status: 'running',   label: 'Corriendo',   color: 'text-blue-400',    icon: <Loader2 className="w-4 h-4 animate-spin" /> },
  { status: 'completed', label: 'Completado',  color: 'text-emerald-400', icon: <CheckCircle2 className="w-4 h-4" /> },
  { status: ['failed', 'cancelled'], label: 'Fallido', color: 'text-red-400', icon: <XCircle className="w-4 h-4" /> },
];

function statusBadge(status: RunStatus): string {
  switch (status) {
    case 'pending':   return 'bg-amber-400/10 text-amber-400 border-amber-400/20';
    case 'running':   return 'bg-blue-400/10 text-blue-400 border-blue-400/20';
    case 'completed': return 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20';
    case 'failed':    return 'bg-red-400/10 text-red-400 border-red-400/20';
    case 'cancelled': return 'bg-zinc-400/10 text-zinc-400 border-zinc-400/20';
    default:          return 'bg-zinc-400/10 text-zinc-400 border-zinc-400/20';
  }
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function matchesColumn(run: WorkflowRun, col: typeof COLUMNS[number]): boolean {
  if (Array.isArray(col.status)) return col.status.includes(run.status);
  return run.status === col.status;
}

// ── Run card ─────────────────────────────────────────────────────────────────

function RunCard({ run }: { run: WorkflowRun }) {
  return (
    <div className="bg-secondary border border-border rounded-lg p-3 space-y-2 text-sm hover:border-accent transition-colors">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-foreground leading-tight">
          {run.workflow?.name ?? 'Workflow'}
        </span>
        <span className={cn('text-[10px] px-1.5 py-0.5 rounded border font-mono shrink-0', statusBadge(run.status))}>
          {run.status}
        </span>
      </div>
      <div className="text-xs text-muted-foreground font-mono">
        #{shortId(run.id)}
      </div>
      {run.error && (
        <div className="flex items-start gap-1.5 text-xs text-red-400 bg-red-400/10 rounded px-2 py-1">
          <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
          <span className="truncate">{run.error}</span>
        </div>
      )}
      <div className="text-[11px] text-muted-foreground">
        {timeAgo(run.startedAt ?? run.createdAt)}
        {run.completedAt && run.startedAt && (
          <span className="ml-2">
            ({Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)}s)
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function KanbanPage() {
  const [runs,     setRuns]     = useState<WorkflowRun[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      const data = await getAllRuns(200);
      setRuns(data);
      setLastSync(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar runs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
    const interval = setInterval(fetchRuns, 5000);
    return () => clearInterval(interval);
  }, [fetchRuns]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Cargando workflows...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Kanban className="w-4 h-4 text-primary" />
          <span>Workflow Runs</span>
          <span className="text-xs text-muted-foreground font-normal">({runs.length} total)</span>
        </div>
        <div className="flex items-center gap-3">
          {lastSync && (
            <span className="text-xs text-muted-foreground hidden sm:block">
              Sincronizado {timeAgo(lastSync.toISOString())}
            </span>
          )}
          <button
            onClick={fetchRuns}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 flex items-center gap-2 text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 shrink-0">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Kanban board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-4 p-4 h-full min-w-max">
          {COLUMNS.map((col) => {
            const colRuns = runs.filter(r => matchesColumn(r, col));
            return (
              <div key={Array.isArray(col.status) ? col.status.join('-') : col.status} className="flex flex-col w-64 shrink-0">
                {/* Column header */}
                <div className="flex items-center justify-between mb-3">
                  <div className={cn('flex items-center gap-2 text-sm font-medium', col.color)}>
                    {col.icon}
                    <span>{col.label}</span>
                  </div>
                  <span className="text-xs text-muted-foreground bg-accent px-1.5 py-0.5 rounded-full">
                    {colRuns.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {colRuns.length === 0 ? (
                    <div className="text-xs text-muted-foreground text-center py-8 border border-dashed border-border rounded-lg">
                      Sin runs
                    </div>
                  ) : (
                    colRuns.map(run => <RunCard key={run.id} run={run} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
