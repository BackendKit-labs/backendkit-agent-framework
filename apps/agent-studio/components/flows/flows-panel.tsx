'use client';

import { useState } from 'react';
import { Plus, Pencil, Trash2, Play, ChevronRight, AlertCircle, Workflow } from 'lucide-react';
import { cn } from '@/components/ui';
import { FlowFormDialog } from './flow-form-dialog';
import type { FlowConfig, AgentConfig } from '@/lib/gateway';
import { saveFlow, deleteFlow } from '@/lib/gateway';

// ── FlowCard ──────────────────────────────────────────────────────────────────

function FlowCard({ flow, onEdit, onDelete }: { flow: FlowConfig; onEdit: () => void; onDelete: () => void }) {
    const [busy, setBusy] = useState(false);
    const [sent, setSent] = useState(false);

    async function runFlow() {
        setBusy(true);
        try {
            await fetch('/api/run', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ flow_id: flow.id, input: {} }),
            });
            setSent(true);
            setTimeout(() => setSent(false), 2000);
        } finally { setBusy(false); }
    }

    return (
        <div className={cn(
            'rounded-xl border bg-card p-4 transition-shadow hover:shadow-md',
            flow.error ? 'border-red-800/40' : 'border-border',
        )}>
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <Workflow className="h-4 w-4 shrink-0 text-primary/70" />
                        <h3 className="truncate font-semibold text-foreground">{flow.name ?? flow.id}</h3>
                    </div>
                    {flow.description && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground pl-6">{flow.description}</p>
                    )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-mono text-muted-foreground max-w-[6rem] truncate">
                        {flow.id}
                    </span>
                    {!flow.error && (
                        <>
                            <button onClick={onEdit}   className="p-1.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-accent transition-colors"><Pencil  className="h-3.5 w-3.5" /></button>
                            <button onClick={onDelete} className="p-1.5 rounded text-muted-foreground/50 hover:text-red-400 hover:bg-red-950/20 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                        </>
                    )}
                </div>
            </div>

            <div className="mt-2 flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground/50">trigger:</span>
                <span className="text-[10px] text-muted-foreground font-mono">{flow.trigger || '(manual only)'}</span>
            </div>

            {flow.error && (
                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-red-400">
                    <AlertCircle className="h-3 w-3 shrink-0" /><span>{flow.error}</span>
                </div>
            )}

            {!flow.error && flow.steps.length > 0 && (
                <div className="mt-3 flex items-center flex-wrap gap-x-0 gap-y-1">
                    {flow.steps.map((step, i) => (
                        <div key={step.id} className="flex items-center">
                            <div className={cn(
                                'flex flex-col rounded-md border px-2 py-1 text-[10px]',
                                step.gate   ? 'border-amber-700/40 bg-amber-950/20' : 'border-border bg-muted/20',
                            )}>
                                <span className={cn('font-medium', step.gate ? 'text-amber-300' : 'text-foreground/80')}>{step.id}</span>
                                <span className="text-muted-foreground/60 font-mono">{step.agent}</span>
                            </div>
                            {i < flow.steps.length - 1 && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/30 mx-0.5" />}
                        </div>
                    ))}
                </div>
            )}

            {!flow.error && (
                <button
                    disabled={busy}
                    onClick={runFlow}
                    className={cn(
                        'mt-3 flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50',
                        sent ? 'bg-emerald-600/20 text-emerald-300' : 'bg-primary/10 text-primary hover:bg-primary/20',
                    )}
                >
                    <Play className="h-3 w-3" />
                    {sent ? 'Started!' : busy ? 'Starting…' : 'Run'}
                </button>
            )}
        </div>
    );
}

// ── FlowsPanel ────────────────────────────────────────────────────────────────

interface FlowsPanelProps {
    flows:    FlowConfig[];
    agentIds: string[];
}

export function FlowsPanel({ flows: initialFlows, agentIds }: FlowsPanelProps) {
    const [flows,      setFlows]      = useState<FlowConfig[]>(initialFlows);
    const [formOpen,   setFormOpen]   = useState(false);
    const [editTarget, setEditTarget] = useState<FlowConfig | undefined>();

    async function handleSave(flow: FlowConfig) {
        const res = await saveFlow(flow);
        if (!res.ok) throw new Error(res.error ?? 'Save failed');
        setFlows(fs => {
            const exists = fs.find(f => f.id === flow.id);
            return exists ? fs.map(f => f.id === flow.id ? { ...flow, error: undefined } : f) : [...fs, flow];
        });
    }

    async function handleDelete(id: string) {
        if (!confirm(`Delete flow "${id}"?`)) return;
        await deleteFlow(id);
        setFlows(fs => fs.filter(f => f.id !== id));
    }

    function openCreate() { setEditTarget(undefined); setFormOpen(true); }
    function openEdit(flow: FlowConfig) { setEditTarget(flow); setFormOpen(true); }

    return (
        <>
            <div className="space-y-4">
                <div className="flex justify-end">
                    <button
                        onClick={openCreate}
                        className="flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
                    >
                        <Plus className="h-3.5 w-3.5" /> New flow
                    </button>
                </div>

                {flows.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                        <Workflow className="h-8 w-8 text-muted-foreground/40" />
                        <p className="text-sm font-medium text-foreground">No flows configured</p>
                        <p className="text-xs text-muted-foreground">Create your first flow to define an agent pipeline.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {flows.map(flow => (
                            <FlowCard
                                key={flow.id}
                                flow={flow}
                                onEdit={() => openEdit(flow)}
                                onDelete={() => handleDelete(flow.id)}
                            />
                        ))}
                    </div>
                )}
            </div>

            <FlowFormDialog
                open={formOpen}
                onClose={() => setFormOpen(false)}
                initial={editTarget}
                agentIds={agentIds}
                onSave={handleSave}
            />
        </>
    );
}
