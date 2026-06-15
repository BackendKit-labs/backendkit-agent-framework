'use client';
import { useEffect, useState } from 'react';
import type { RunState } from '@/lib/gateway';
import { RunCard } from './run-card';
import { RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { cn } from '@/components/ui';

interface Column {
    key:    RunState['status'] | 'failed';
    label:  string;
    color:  string;
    dot:    string;
    extra?: RunState['status'];
}

const COLUMNS: Column[] = [
    { key: 'running',       label: 'Running',       color: 'text-blue-400',    dot: 'bg-blue-400'    },
    { key: 'waiting_gate',  label: 'Waiting Gate',  color: 'text-amber-400',   dot: 'bg-amber-400'   },
    { key: 'waiting_retry', label: 'Waiting Retry', color: 'text-orange-400',  dot: 'bg-orange-400'  },
    { key: 'done',          label: 'Done',          color: 'text-emerald-400', dot: 'bg-emerald-400' },
    { key: 'failed',        label: 'Failed',        color: 'text-red-400',     dot: 'bg-red-400', extra: 'cancelled' },
];

export function KanbanBoard() {
    const [runs,        setRuns]        = useState<RunState[]>([]);
    const [loading,     setLoading]     = useState(true);
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
    const [connected,   setConnected]   = useState(false);
    const [error,       setError]       = useState<string | null>(null);

    const gatewayUrl = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3400';

    useEffect(() => {
        const es = new EventSource(`${gatewayUrl}/api/runs/stream`);

        es.onmessage = (e: MessageEvent<string>) => {
            try {
                setRuns(JSON.parse(e.data) as RunState[]);
                setLastRefresh(new Date());
                setConnected(true);
                setLoading(false);
                setError(null);
            } catch { /* ignore malformed frame */ }
        };

        es.onopen = () => { setConnected(true); setError(null); };

        es.onerror = () => {
            setConnected(false);
            setError('SSE disconnected — reconnecting…');
        };

        return () => es.close();
    }, []);

    function runsForColumn(col: Column): RunState[] {
        return runs.filter(r => r.status === col.key || (col.extra && r.status === col.extra));
    }

    return (
        <div className="flex h-full flex-col overflow-hidden">
            {/* Toolbar */}
            <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-2.5">
                <span className="text-xs text-muted-foreground">
                    {loading
                        ? <span className="flex items-center gap-1.5"><RefreshCw className="h-3 w-3 animate-spin" /> Connecting…</span>
                        : error
                            ? <span className="flex items-center gap-1.5 text-red-400"><WifiOff className="h-3 w-3" />{error}</span>
                            : `${runs.length} run${runs.length !== 1 ? 's' : ''} · updated ${lastRefresh?.toLocaleTimeString()}`
                    }
                </span>
                <span className={cn(
                    'flex items-center gap-1.5 text-xs',
                    connected ? 'text-emerald-400' : 'text-muted-foreground',
                )}>
                    {connected
                        ? <><Wifi className="h-3 w-3" /> live</>
                        : <><WifiOff className="h-3 w-3" /> offline</>
                    }
                </span>
            </div>

            {/* Kanban columns */}
            <div className="flex flex-1 gap-3 overflow-x-auto p-4">
                {COLUMNS.map(col => {
                    const colRuns = runsForColumn(col);
                    return (
                        <div key={col.key} className="flex w-[17rem] shrink-0 flex-col gap-2.5">
                            {/* Column header */}
                            <div className="flex items-center gap-2 px-1">
                                <span className={cn('h-2 w-2 rounded-full', col.dot)} />
                                <span className={cn('text-xs font-semibold uppercase tracking-wide', col.color)}>
                                    {col.label}
                                </span>
                                <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                    {colRuns.length}
                                </span>
                            </div>

                            {/* Cards */}
                            <div className="flex flex-col gap-2 overflow-y-auto pb-1 pr-0.5">
                                {colRuns.length === 0 ? (
                                    <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-xs text-muted-foreground/50">
                                        No runs
                                    </div>
                                ) : (
                                    colRuns.map(run => (
                                        <RunCard
                                            key={run.id}
                                            run={run}
                                        />
                                    ))
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
