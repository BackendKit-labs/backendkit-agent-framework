'use client';
import { useState } from 'react';
import type { RunState } from '@/lib/gateway';
import {
    cn, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
    DialogFooter, Button, Textarea,
} from '@/components/ui';
import { Check, X, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60)  return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60)  return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ago`;
}

interface ActionDialogProps {
    open:        boolean;
    onClose:     () => void;
    title:       string;
    description: string;
    placeholder: string;
    actionLabel: string;
    actionClass: string;
    onConfirm:   (feedback: string) => Promise<void>;
}

function ActionDialog({ open, onClose, title, description, placeholder, actionLabel, actionClass, onConfirm }: ActionDialogProps) {
    const [text, setText] = useState('');
    const [busy, setBusy]  = useState(false);

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
                <Textarea
                    value={text}
                    onChange={e => setText(e.target.value)}
                    placeholder={placeholder}
                    rows={3}
                />
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

interface RunCardProps {
    run: RunState;
}

export function RunCard({ run }: RunCardProps) {
    const [expanded,     setExpanded]     = useState(false);
    const [approveOpen,  setApproveOpen]  = useState(false);
    const [rejectOpen,   setRejectOpen]   = useState(false);
    const [retryOpen,    setRetryOpen]    = useState(false);
    const [actionBusy,   setActionBusy]   = useState(false);

    const shortId    = run.id.slice(-8);
    const stepCount  = Array.isArray(run.results) ? run.results.length : 0;

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
                'rounded-lg border bg-card p-3 text-sm animate-fade-in transition-shadow hover:shadow-md cursor-default',
                run.status === 'running'       && 'border-blue-800/40',
                run.status === 'waiting_gate'  && 'border-amber-700/50',
                run.status === 'waiting_retry' && 'border-orange-700/50',
                run.status === 'done'          && 'border-emerald-800/30',
                run.status === 'failed'        && 'border-red-800/50',
                run.status === 'cancelled'     && 'border-zinc-700/40',
            )}>
                {/* Top row */}
                <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground tracking-wide">…{shortId}</span>
                    <button
                        onClick={() => setExpanded(e => !e)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                        {expanded
                            ? <ChevronUp   className="h-3.5 w-3.5" />
                            : <ChevronDown className="h-3.5 w-3.5" />
                        }
                    </button>
                </div>

                {/* Flow + time */}
                <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="font-medium text-foreground">{run.flowId}</span>
                    <span className="text-[11px] text-muted-foreground">
                        {stepCount} step{stepCount !== 1 ? 's' : ''} · {timeAgo(run.createdAt)}
                    </span>
                </div>

                {/* Gate / failed indicators */}
                {run.gateStepId && (
                    <div className="mt-1.5 text-[11px] text-amber-400 font-mono">⏸ {run.gateStepId}</div>
                )}
                {run.failedStepId && (
                    <div className="mt-1.5 text-[11px] text-orange-400 font-mono">✗ {run.failedStepId}</div>
                )}

                {/* Running pulse */}
                {run.status === 'running' && (
                    <div className="mt-1.5 flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse-dot" />
                        <span className="text-[11px] text-muted-foreground">in progress</span>
                    </div>
                )}

                {/* Expanded */}
                {expanded && (
                    <div className="mt-2 space-y-1.5 border-t border-border pt-2">
                        {run.summary && (
                            <p className="text-[11px] text-muted-foreground line-clamp-5 whitespace-pre-wrap">{run.summary}</p>
                        )}
                        {run.error && (
                            <p className="text-[11px] text-red-400">{run.error}</p>
                        )}
                        <div className="text-[10px] text-muted-foreground/50 font-mono">
                            {new Date(run.updatedAt).toLocaleString()}
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
                            Retry step
                        </button>
                    </div>
                )}
            </div>

            {/* Dialogs */}
            <ActionDialog
                open={approveOpen}
                onClose={() => setApproveOpen(false)}
                title="Approve gate"
                description={`Resume flow run …${shortId}`}
                placeholder="Optional feedback for the next steps..."
                actionLabel="Approve"
                actionClass="bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30"
                onConfirm={feedback => doAction(`/api/runs/${run.id}/approve`, { feedback })}
            />
            <ActionDialog
                open={rejectOpen}
                onClose={() => setRejectOpen(false)}
                title="Reject gate"
                description={`Cancel flow run …${shortId}`}
                placeholder="Reason for rejection..."
                actionLabel="Reject"
                actionClass="bg-red-600/20 text-red-300 hover:bg-red-600/30"
                onConfirm={reason => doAction(`/api/runs/${run.id}/reject`, { reason })}
            />
            <ActionDialog
                open={retryOpen}
                onClose={() => setRetryOpen(false)}
                title="Retry failed step"
                description={`Retry step "${run.failedStepId ?? ''}" in run …${shortId}`}
                placeholder="Optional context for the retry..."
                actionLabel="Retry"
                actionClass="bg-orange-600/20 text-orange-300 hover:bg-orange-600/30"
                onConfirm={feedback => doAction(`/api/runs/${run.id}/retry`, { feedback })}
            />
        </>
    );
}
