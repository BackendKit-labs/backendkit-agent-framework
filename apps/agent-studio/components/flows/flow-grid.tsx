'use client';

import { useState } from 'react';
import type { FlowConfig } from '@/lib/gateway';
import { cn } from '@/components/ui';
import { Workflow, ChevronRight, Play, AlertCircle } from 'lucide-react';

// ── FlowStepPipeline ──────────────────────────────────────────────────────────

function FlowStepPipeline({ steps }: { steps: FlowConfig['steps'] }) {
    if (steps.length === 0) return <p className="text-[11px] text-muted-foreground/50">No steps defined</p>;

    return (
        <div className="mt-3 flex items-center flex-wrap gap-x-0 gap-y-1">
            {steps.map((step, i) => (
                <div key={step.id} className="flex items-center">
                    <div className={cn(
                        'flex flex-col rounded-md border px-2 py-1 text-[10px]',
                        step.gate   && 'border-amber-700/40 bg-amber-950/20',
                        step.require && !step.gate && 'border-orange-700/40 bg-orange-950/20',
                        !step.gate && !step.require && 'border-border bg-muted/20',
                    )}>
                        <span className={cn(
                            'font-medium',
                            step.gate   ? 'text-amber-300' : 'text-foreground/80',
                        )}>
                            {step.id}
                        </span>
                        <span className="text-muted-foreground/60 font-mono">{step.agent}</span>
                    </div>
                    {i < steps.length - 1 && (
                        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/30 mx-0.5" />
                    )}
                </div>
            ))}
        </div>
    );
}

// ── FlowCard ──────────────────────────────────────────────────────────────────

function FlowCard({ flow }: { flow: FlowConfig }) {
    const [busy, setBusy] = useState(false);
    const [sent, setSent] = useState(false);

    async function runFlow() {
        setBusy(true);
        try {
            await fetch('/api/run', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ flow_id: flow.id, input: {} }),
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
            {/* Header */}
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
                <span className="shrink-0 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-mono text-muted-foreground truncate max-w-[6rem]">
                    {flow.id}
                </span>
            </div>

            {/* Trigger */}
            <div className="mt-2 flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground/50">trigger:</span>
                <span className="text-[10px] text-muted-foreground font-mono">{flow.trigger}</span>
            </div>

            {/* Error */}
            {flow.error && (
                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-red-400">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    <span>{flow.error}</span>
                </div>
            )}

            {/* Step pipeline */}
            {!flow.error && <FlowStepPipeline steps={flow.steps} />}

            {/* Run button */}
            {!flow.error && (
                <button
                    disabled={busy}
                    onClick={runFlow}
                    className={cn(
                        'mt-3 flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50',
                        sent
                            ? 'bg-emerald-600/20 text-emerald-300'
                            : 'bg-primary/10 text-primary hover:bg-primary/20',
                    )}
                >
                    <Play className="h-3 w-3" />
                    {sent ? 'Started!' : busy ? 'Starting…' : 'Run'}
                </button>
            )}
        </div>
    );
}

// ── FlowGrid ──────────────────────────────────────────────────────────────────

interface FlowGridProps {
    flows: FlowConfig[];
}

export function FlowGrid({ flows }: FlowGridProps) {
    if (flows.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/40">
                    <Workflow className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                    <p className="text-sm font-medium text-foreground">No flows configured</p>
                    <p className="mt-1 text-xs text-muted-foreground">Add flows to your orchestrator-mcp.yaml to see them here.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {flows.map(flow => (
                <FlowCard key={flow.id} flow={flow} />
            ))}
        </div>
    );
}
