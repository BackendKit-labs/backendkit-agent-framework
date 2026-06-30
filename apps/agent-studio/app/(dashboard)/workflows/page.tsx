import type { Metadata } from 'next';
import Link from 'next/link';
import { Topbar } from '@/components/layout/topbar';
import { Workflow, Plus, Play, ArrowRight } from 'lucide-react';
import { listWorkflows } from '@/lib/director';
import { cn } from '@/components/ui';

export const metadata: Metadata = { title: 'Workflows' };

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-emerald-950/40 text-emerald-400 border-emerald-700/30',
  draft:  'bg-zinc-800 text-zinc-400 border-zinc-700/30',
  paused: 'bg-amber-950/40 text-amber-400 border-amber-700/30',
};

export default async function WorkflowsPage() {
  let workflows: Awaited<ReturnType<typeof listWorkflows>> = [];
  let fetchError = '';

  try {
    workflows = await listWorkflows();
  } catch (e) {
    fetchError = e instanceof Error ? e.message : 'Error al cargar workflows';
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Topbar
        title="Workflows"
        subtitle={
          fetchError
            ? 'No se pudo conectar a director-api'
            : `${workflows.length} workflow${workflows.length !== 1 ? 's' : ''}`
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {fetchError ? (
          <div className="rounded-xl border border-red-800/30 bg-red-950/20 p-4 text-sm text-red-400">
            {fetchError} — verificá que director-api esté corriendo en el puerto 4000.
          </div>
        ) : workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <Workflow className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-medium text-foreground">Sin workflows</p>
            <p className="text-xs text-muted-foreground">Creá tu primer workflow en director-api.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workflows.map(wf => (
              <div
                key={wf.id}
                className="group rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Workflow className="h-4 w-4 shrink-0 text-primary/70" />
                      <h3 className="truncate font-semibold text-foreground">{wf.name}</h3>
                    </div>
                    {wf.description && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground pl-6">
                        {wf.description}
                      </p>
                    )}
                  </div>
                  <span className={cn(
                    'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                    STATUS_BADGE[wf.status] ?? STATUS_BADGE.draft,
                  )}>
                    {wf.status}
                  </span>
                </div>

                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                  <span>trigger:</span>
                  <span className="font-mono">{wf.trigger}</span>
                  <span className="ml-auto">{wf.steps.length} pasos</span>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <Link
                    href={`/workflows/${wf.id}`}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
                  >
                    Abrir builder
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
