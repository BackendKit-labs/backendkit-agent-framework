'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Plus, Save, Play, Loader2, Check, AlertCircle } from 'lucide-react';
import { cn } from '@/components/ui';
import { StepNode, type StepNodeData } from './StepNode';
import { TerminalNode, type TerminalNodeData } from './TerminalNode';
import { StepSidebar } from './StepSidebar';
import {
  updateWorkflow,
  runWorkflow,
  type Workflow,
  type WorkflowStep,
  type Deployable,
} from '@/lib/director';

const NODE_TYPES = { step: StepNode, terminal: TerminalNode };

const START_NODE: Node<TerminalNodeData> = {
  id: '__start__',
  type: 'terminal',
  position: { x: 0, y: 80 },
  data: { label: 'Inicio', kind: 'start' },
  draggable: false,
  selectable: false,
};

const END_NODE_X_BASE = 220;

function stepsToNodes(steps: WorkflowStep[], deployables: Deployable[]): Node<StepNodeData>[] {
  return steps.map(s => ({
    id: s.id,
    type: 'step',
    position: { x: END_NODE_X_BASE + (s.order - 1) * 190, y: 60 },
    data: {
      order: s.order,
      deployableName: s.deployable?.name ?? (s.deployableId ? 'Desconocido' : null),
      hasConfig: !!(s.config && Object.keys(s.config).length > 0),
      selected: false,
    },
    draggable: false,
  }));
}

function buildEdges(steps: WorkflowStep[]): Edge[] {
  const sorted = [...steps].sort((a, b) => a.order - b.order);
  const edges: Edge[] = [];

  if (sorted.length > 0) {
    edges.push({
      id: `__start__->${sorted[0].id}`,
      source: '__start__',
      target: sorted[0].id,
      animated: false,
    });
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    edges.push({
      id: `${sorted[i].id}->${sorted[i + 1].id}`,
      source: sorted[i].id,
      target: sorted[i + 1].id,
      animated: false,
    });
  }

  const last = sorted.at(-1);
  if (last) {
    edges.push({
      id: `${last.id}->__end__`,
      source: last.id,
      target: '__end__',
      animated: false,
    });
  }

  return edges;
}

function endNodePosition(steps: WorkflowStep[]): { x: number; y: number } {
  const count = steps.length;
  return { x: END_NODE_X_BASE + count * 190, y: 80 };
}

// ── Main component ──────────────────────────────────────────────────────────

interface Props {
  workflow: Workflow;
  deployables: Deployable[];
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type RunState  = 'idle' | 'running' | 'started';

export function WorkflowCanvas({ workflow: initial, deployables }: Props) {
  const [workflow, setWorkflow] = useState<Workflow>(initial);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [runState,  setRunState]  = useState<RunState>('idle');

  // Build end node from current steps
  const endNode = useMemo<Node<TerminalNodeData>>(() => ({
    id: '__end__',
    type: 'terminal',
    position: endNodePosition(workflow.steps),
    data: { label: 'Fin', kind: 'end' },
    draggable: false,
    selectable: false,
  }), [workflow.steps]);

  const stepNodes = useMemo(() => stepsToNodes(workflow.steps, deployables), [workflow.steps, deployables]);
  const edges     = useMemo(() => buildEdges(workflow.steps), [workflow.steps]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([START_NODE, ...stepNodes, endNode]);
  const [edgesList, , onEdgesChange]      = useEdgesState<Edge>(edges);

  // Sync nodes/edges when workflow steps change
  useEffect(() => {
    setNodes([
      START_NODE,
      ...stepsToNodes(workflow.steps, deployables),
      endNodePosition(workflow.steps) && {
        ...endNode,
        position: endNodePosition(workflow.steps),
      },
    ].filter(Boolean) as Node[]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow.steps]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === 'step') setSelectedStepId(node.id);
  }, []);

  const onPaneClick = useCallback(() => setSelectedStepId(null), []);

  // ── Step mutations ────────────────────────────────────────────────────────

  function addStep() {
    const maxOrder = workflow.steps.reduce((m, s) => Math.max(m, s.order), 0);
    const tempId   = `new-${Date.now()}`;
    const newStep: WorkflowStep = {
      id: tempId,
      workflowId: workflow.id,
      order: maxOrder + 1,
      deployableId: null,
      config: null,
    };
    setWorkflow(w => ({ ...w, steps: [...w.steps, newStep] }));
    setSelectedStepId(tempId);
  }

  function updateStep(id: string, patch: Partial<Pick<WorkflowStep, 'deployableId' | 'config'>>) {
    setWorkflow(w => ({
      ...w,
      steps: w.steps.map(s => s.id === id ? { ...s, ...patch } : s),
    }));
    setSaveState('idle');
  }

  function deleteStep(id: string) {
    setWorkflow(w => {
      const remaining = w.steps
        .filter(s => s.id !== id)
        .map((s, i) => ({ ...s, order: i + 1 }));
      return { ...w, steps: remaining };
    });
    setSelectedStepId(null);
    setSaveState('idle');
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function save() {
    setSaveState('saving');
    try {
      const dto = {
        steps: workflow.steps.map(s => ({
          order: s.order,
          ...(s.deployableId ? { deployableId: s.deployableId } : {}),
          ...(s.config       ? { config: s.config }             : {}),
        })),
      };
      const updated = await updateWorkflow(workflow.id, dto);
      setWorkflow(updated);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch {
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 3000);
    }
  }

  // ── Run ───────────────────────────────────────────────────────────────────

  async function run() {
    if (runState === 'running') return;
    setRunState('running');
    try {
      await runWorkflow(workflow.id);
      setRunState('started');
      setTimeout(() => setRunState('idle'), 2500);
    } catch {
      setRunState('idle');
    }
  }

  const selectedStep = selectedStepId
    ? workflow.steps.find(s => s.id === selectedStepId) ?? null
    : null;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Toolbar */}
      <div className="flex h-12 items-center justify-between border-b border-border px-4 bg-card shrink-0">
        <div className="flex items-center gap-3">
          <span className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
            workflow.status === 'active'  && 'bg-emerald-950/40 text-emerald-400 border border-emerald-700/30',
            workflow.status === 'draft'   && 'bg-zinc-800 text-zinc-400 border border-zinc-700/30',
            workflow.status === 'paused'  && 'bg-amber-950/40 text-amber-400 border border-amber-700/30',
          )}>
            {workflow.status}
          </span>
          <span className="text-xs text-muted-foreground">
            trigger: <span className="font-mono">{workflow.trigger}</span>
          </span>
          <span className="text-xs text-muted-foreground">
            {workflow.steps.length} pasos
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={addStep}
            className="flex items-center gap-1.5 rounded-md bg-muted/60 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Agregar paso
          </button>

          <button
            onClick={save}
            disabled={saveState === 'saving'}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              saveState === 'saved'  && 'bg-emerald-600/20 text-emerald-300',
              saveState === 'error'  && 'bg-red-600/20 text-red-400',
              saveState !== 'saved' && saveState !== 'error' && 'bg-primary/10 text-primary hover:bg-primary/20',
              saveState === 'saving' && 'opacity-60 cursor-not-allowed',
            )}
          >
            {saveState === 'saving' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {saveState === 'saved'  && <Check className="h-3.5 w-3.5" />}
            {saveState === 'error'  && <AlertCircle className="h-3.5 w-3.5" />}
            {saveState === 'idle'   && <Save className="h-3.5 w-3.5" />}
            {saveState === 'saving' ? 'Guardando…' : saveState === 'saved' ? 'Guardado' : saveState === 'error' ? 'Error' : 'Guardar'}
          </button>

          <button
            onClick={run}
            disabled={runState === 'running'}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60',
              runState === 'started'
                ? 'bg-emerald-600/20 text-emerald-300'
                : 'bg-emerald-600/10 text-emerald-400 hover:bg-emerald-600/20',
            )}
          >
            {runState === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {runState === 'started' ? '¡Iniciado!' : runState === 'running' ? 'Iniciando…' : 'Ejecutar'}
          </button>
        </div>
      </div>

      {/* Canvas + sidebar */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 bg-background">
          <ReactFlow
            nodes={nodes}
            edges={edgesList}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={NODE_TYPES}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            minZoom={0.3}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Controls className="!bg-card !border-border !shadow-none [&>button]:!bg-card [&>button]:!border-border [&>button:hover]:!bg-accent" />
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="hsl(var(--border))" />
          </ReactFlow>
        </div>

        {selectedStep && (
          <StepSidebar
            step={selectedStep}
            deployables={deployables}
            onUpdate={patch => updateStep(selectedStep.id, patch)}
            onDelete={() => deleteStep(selectedStep.id)}
            onClose={() => setSelectedStepId(null)}
          />
        )}
      </div>
    </div>
  );
}
