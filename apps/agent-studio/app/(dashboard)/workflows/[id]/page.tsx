import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { WorkflowCanvas } from '@/components/workflow-builder/WorkflowCanvas';
import { getWorkflow, listDeployables } from '@/lib/director';

interface Props {
  params: { id: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const wf = await getWorkflow(params.id);
    return { title: `Builder — ${wf.name}` };
  } catch {
    return { title: 'Workflow Builder' };
  }
}

export default async function WorkflowBuilderPage({ params }: Props) {
  let workflow: Awaited<ReturnType<typeof getWorkflow>> | null = null;
  let deployables: Awaited<ReturnType<typeof listDeployables>> = [];
  let error = '';

  try {
    [workflow, deployables] = await Promise.all([
      getWorkflow(params.id),
      listDeployables().catch(() => []),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error al cargar workflow';
  }

  if (error || !workflow) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6">
        <Link
          href="/workflows"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
        >
          <ArrowLeft className="h-4 w-4" /> Volver a Workflows
        </Link>
        <div className="rounded-xl border border-red-800/30 bg-red-950/20 p-4 text-sm text-red-400">
          {error || 'Workflow no encontrado'}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Page header */}
      <div className="flex h-12 items-center gap-3 border-b border-border px-4 bg-card shrink-0">
        <Link
          href="/workflows"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Workflows
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <span className="text-sm font-semibold text-foreground truncate">{workflow.name}</span>
      </div>

      {/* Visual builder */}
      <WorkflowCanvas workflow={workflow} deployables={deployables} />
    </div>
  );
}
