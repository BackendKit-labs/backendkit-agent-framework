'use client';
import { useState } from 'react';
import type { RunState, StepResult } from '@/lib/gateway';
import {
    cn, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
    DialogFooter, Button, Textarea,
} from '@/components/ui';
import { Check, X, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60)  return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60)  return `${m}m ago`;
    return `${Math.floor(m / 60)}h ago`;
}

function elapsed(start: string, end: string): string {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function fmtDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

// Extract the most meaningful string from the flow input
function runTitle(input: Record<string, unknown>): string {
    for (const key of ['query', 'task', 'subject', 'title', 'name', 'description', 'message', 'prompt']) {
        if (typeof input[key] === 'string' && (input[key] as string).trim()) return input[key] as string;
    }
    const first = Object.values(input).find(v => typeof v === 'string' && (v as string).trim());
    return typeof first === 'string' ? first : '';
}

// Try to parse JSON output and format as "key: value" pairs
function formatOutput(output: string): string {
    try {
        const obj = JSON.parse(output) as Record<string, unknown>;
        return Object.entries(obj)
            .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
            .map(([k, v]) => `${k}: ${String(v)}`)
            .join('  ·  ');
    } catch {
        return output.slice(0, 120).replace(/\n/g, ' ');
    }
}

// ── ActionDialog ──────────────────────────────────────────────────────────────

interface ActionDialogProps {
    open:        boolean;
    onClose:     () => void;
    title:       string;
    description: string;
    placeholder: string;
    actionLabel: string;
    actionClass: string;
    onConfirm:   (text: string) => Promise<void>;
}

function ActionDialog({ open, onClose, title, description, placeholder, actionLabel, actionClass, onConfirm }: ActionDialogProps) {
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    async function handle() {
        setBusy(true);
        try { await onConfirm(text); onClose(); } finally { setBusy(false); }
    }
    return (
        <Dialog open={open} onOpenChange={v => !v && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <Textarea value={text} onChange={e => setText(e.target.value)} placeholder={placeholder} rows={3} />
                <DialogFooter>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
                    <button
                        disabled={busy}
                        onClick={handle}
                        className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50', actionClass)}
                    >
                        {busy && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                        {actionLabel}
                    </button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── StepTimeline ──────────────────────────────────────────────────────────────

function StepTimeline({ results, currentStepId, gateStepId }: {
    results:       StepResult[];
    currentStepId?: string;
    gateStepId?:   string;
}) {
    if (results.length === 0 && !currentStepId) return null;

    return (
        <div className="mt-2 space-y-1">
            {results.map(r => {
                const isGated = r.stepId === gateStepId;
                return (
                    <div key={r.stepId} className="flex items-center gap-1.5 text-[11px]">
                        <span className={cn(
                            'shrink-0 font-mono',
                            r.success ? 'text-emerald-400' : 'text-red-400',
                        )}>
                            {r.success ? '✓' : '✗'}
                        </span>
                        <span className={cn('font-medium', isGated ? 'text-amber-300' : 'text-foreground/80')}>
                            {r.stepId}
                        </span>
                        <span className="text-muted-foreground/60">·</span>
                        <span className="text-muted-foreground/70">{r.agentId}</span>
                        <span className="ml-auto font-mono text-muted-foreground/50">{fmtDuration(r.durationMs)}</span>
                    </div>
                );
            })}

            {/* Current step executing */}
            {currentStepId && (
                <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400 animate-pulse" />
                    <span className="font-medium text-blue-300">{currentStepId}</span>
                    <span className="text-muted-foreground/50 ml-1">running…</span>
                </div>
            )}
        </div>
    );
}

// ── GateDetail ────────────────────────────────────────────────────────────────

function GateDetail({ results, gateStepId, gateCriteria }: {
    results:       StepResult[];
    gateStepId:    string;
    gateCriteria?: string[];
}) {
    const gateResult = results.find(r => r.stepId === gateStepId);
    if (!gateResult) return null;

    const outputText = formatOutput(gateResult.output);

    return (
        <div className="mt-2 space-y-1.5 rounded-md border border-amber-700/30 bg-amber-950/20 px-2.5 py-2">
            <p className="text-[11px] text-amber-200/80 line-clamp-2">{outputText}</p>
            {gateCriteria && gateCriteria.length > 0 && (
                <ul className="space-y-0.5">
                    {gateCriteria.map((c, i) => (
                        <li key={i} className="flex gap-1 text-[10px] text-muted-foreground">
                            <span className="text-amber-500/70 shrink-0">•</span>
                            <span>{c}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

// ── RunCard ───────────────────────────────────────────────────────────────────

interface RunCardProps {
    run: RunState;
}

export function RunCard({ run }: RunCardProps) {
    const [expanded,    setExpanded]    = useState(false);
    const [approveOpen, setApproveOpen] = useState(false);
    const [rejectOpen,  setRejectOpen]  = useState(false);
    const [retryOpen,   setRetryOpen]   = useState(false);
    const [actionBusy,  setActionBusy]  = useState(false);

    const shortId = run.id.slice(-8);
    const title   = runTitle(run.input);
    const dur     = elapsed(run.createdAt, run.updatedAt);

    async function doAction(path: string, body: Record<string, unknown>) {
        setActionBusy(true);
        try {
            await fetch(path, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(body),
            });
        } finally { setActionBusy(false); }
    }

    return (
        <>
            <div className={cn(
                'rounded-lg border bg-card p-3 text-sm transition-shadow hover:shadow-md cursor-default',
                run.status === 'running'       && 'border-blue-800/40',
                run.status === 'waiting_gate'  && 'border-amber-700/50',
                run.status === 'waiting_retry' && 'border-orange-700/50',
                run.status === 'done'          && 'border-emerald-800/30',
                run.status === 'failed'        && 'border-red-800/50',
                run.status === 'cancelled'     && 'border-zinc-700/40',
            )}>
                {/* Header row: flow badge + elapsed + expand */}
                <div className="flex items-center gap-2">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground/70 truncate max-w-[8rem]">
                        {run.flowId}
                    </span>
                    <span className="ml-auto text-[10px] text-muted-foreground/50 shrink-0">{dur}</span>
                    <button
                        onClick={() => setExpanded(e => !e)}
                        className="shrink-0 text-muted-foreground/50 hover:text-foreground transition-colors"
                    >
                        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                </div>

                {/* Primary title — the real business context */}
                {title && (
                    <p className="mt-1.5 text-[12px] font-medium text-foreground leading-snug line-clamp-2">
                        {title}
                    </p>
                )}
                {!title && (
                    <p className="mt-1.5 font-mono text-[10px] text-muted-foreground/50">…{shortId}</p>
                )}

                {/* Step timeline */}
                <StepTimeline
                    results={run.results}
                    currentStepId={run.currentStepId}
                    gateStepId={run.gateStepId}
                />

                {/* Gate detail */}
                {run.status === 'waiting_gate' && run.gateStepId && (
                    <GateDetail
                        results={run.results}
                        gateStepId={run.gateStepId}
                        gateCriteria={run.gateCriteria}
                    />
                )}

                {/* Expanded: full input + error + timestamp */}
                {expanded && (
                    <div className="mt-2 space-y-1.5 border-t border-border pt-2">
                        <div className="text-[10px] text-muted-foreground/50 space-y-0.5">
                            {Object.entries(run.input).map(([k, v]) => (
                                <div key={k} className="flex gap-1">
                                    <span className="text-muted-foreground/40 shrink-0">{k}:</span>
                                    <span className="line-clamp-2">{String(v)}</span>
                                </div>
                            ))}
                        </div>
                        {run.error && (
                            <p className="text-[11px] text-red-400">{run.error}</p>
                        )}
                        <div className="text-[10px] text-muted-foreground/30 font-mono">
                            {new Date(run.updatedAt).toLocaleString()}  ·  …{shortId}
                        </div>
                    </div>
                )}

                {/* Actions */}
                {run.status === 'waiting_gate' && (
                    <div className="mt-2.5 flex gap-2">
                        <button
                            disabled={actionBusy}
                            onClick={() => setApproveOpen(true)}
                            className="flex flex-1 items-center justify-center gap-1 rounded-md bg-emerald-600/15 px-2 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-600/25 disabled:opacity-50 transition-colors"
                        >
                            <Check className="h-3 w-3" /> Approve
                        </button>
                        <button
                            disabled={actionBusy}
                            onClick={() => setRejectOpen(true)}
                            className="flex flex-1 items-center justify-center gap-1 rounded-md bg-red-600/15 px-2 py-1.5 text-xs font-medium text-red-400 hover:bg-red-600/25 disabled:opacity-50 transition-colors"
                        >
                            <X className="h-3 w-3" /> Reject
                        </button>
                    </div>
                )}

                {run.status === 'waiting_retry' && (
                    <div className="mt-2.5">
                        <button
                            disabled={actionBusy}
                            onClick={() => setRetryOpen(true)}
                            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-orange-600/15 px-2 py-1.5 text-xs font-medium text-orange-400 hover:bg-orange-600/25 disabled:opacity-50 transition-colors"
                        >
                            <RefreshCw className={cn('h-3 w-3', actionBusy && 'animate-spin')} />
                            Retry {run.failedStepId ?? 'step'}
                        </button>
                    </div>
                )}
            </div>

            {/* Dialogs */}
            <ActionDialog
                open={approveOpen}
                onClose={() => setApproveOpen(false)}
                title="Approve gate"
                description={`Resume "${title || shortId}" — step: ${run.gateStepId ?? ''}`}
                placeholder="Optional feedback for the next steps..."
                actionLabel="Approve"
                actionClass="bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30"
                onConfirm={feedback => doAction(`/api/runs/${run.id}/approve`, { feedback })}
            />
            <ActionDialog
                open={rejectOpen}
                onClose={() => setRejectOpen(false)}
                title="Reject gate"
                description={`Cancel "${title || shortId}"`}
                placeholder="Reason for rejection..."
                actionLabel="Reject"
                actionClass="bg-red-600/20 text-red-300 hover:bg-red-600/30"
                onConfirm={reason => doAction(`/api/runs/${run.id}/reject`, { reason })}
            />
            <ActionDialog
                open={retryOpen}
                onClose={() => setRetryOpen(false)}
                title="Retry failed step"
                description={`Retry "${run.failedStepId ?? 'step'}" in "${title || shortId}"`}
                placeholder="Optional context for the retry..."
                actionLabel="Retry"
                actionClass="bg-orange-600/20 text-orange-300 hover:bg-orange-600/30"
                onConfirm={feedback => doAction(`/api/runs/${run.id}/retry`, { feedback })}
            />
        </>
    );
}
