import { cn } from '@/lib/utils';
import { Loader2, CheckCircle2, XCircle, Wrench, Clock } from 'lucide-react';
import type { KanbanRun, KanbanToolCall } from '@/hooks/useKanbanMonitor';

// ── Tool badge ────────────────────────────────────────────────────────────────

function ToolBadge({ tc }: { tc: KanbanToolCall }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
      tc.status === 'pending' && 'bg-indigo-950/60 text-indigo-300 border border-indigo-800/40',
      tc.status === 'done'    && 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/40',
      tc.status === 'error'   && 'bg-red-950/60 text-red-300 border border-red-800/40',
    )}>
      {tc.status === 'pending' && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      {tc.status === 'done'    && <CheckCircle2 className="h-2.5 w-2.5" />}
      {tc.status === 'error'   && <XCircle className="h-2.5 w-2.5" />}
      <Wrench className="h-2.5 w-2.5 opacity-50" />
      <span className="max-w-[120px] truncate">{tc.name}</span>
    </span>
  );
}

// ── Elapsed time ──────────────────────────────────────────────────────────────

function elapsed(start: Date, end?: Date): string {
  const ms = (end ?? new Date()).getTime() - start.getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ── Card ──────────────────────────────────────────────────────────────────────

const columnBorder: Record<KanbanRun['column'], string> = {
  pending: 'border-zinc-700/60',
  running: 'border-indigo-700/60',
  waiting: 'border-amber-700/60',
  done:    'border-emerald-700/60',
  error:   'border-red-700/60',
};

const columnAccent: Record<KanbanRun['column'], string> = {
  pending: 'bg-zinc-800/40',
  running: 'bg-indigo-950/30',
  waiting: 'bg-amber-950/30',
  done:    'bg-emerald-950/30',
  error:   'bg-red-950/30',
};

interface KanbanCardProps {
  run: KanbanRun;
}

export function KanbanCard({ run }: KanbanCardProps) {
  return (
    <div className={cn(
      'rounded-lg border p-3 text-sm transition-all duration-300',
      columnBorder[run.column],
      columnAccent[run.column],
    )}>
      {/* Agent + session */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {run.agentIcon && <span className="shrink-0">{run.agentIcon}</span>}
          <span className="truncate text-xs font-medium text-foreground/80">
            {run.agentName ?? run.agentId ?? '—'}
          </span>
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground font-mono">
          {run.sessionId.slice(0, 8)}
        </span>
      </div>

      {/* Title */}
      <p className="text-foreground/90 leading-snug mb-2.5 line-clamp-3 text-xs">
        {run.title}
      </p>

      {/* Tool calls */}
      {run.toolCalls.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2.5">
          {run.toolCalls.map(tc => <ToolBadge key={tc.id} tc={tc} />)}
        </div>
      )}

      {/* Footer: time + tokens */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {elapsed(run.startedAt, run.completedAt)}
        </span>
        {run.tokens > 0 && <span>{run.tokens} tok</span>}
      </div>
    </div>
  );
}
