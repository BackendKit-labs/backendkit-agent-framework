'use client';
import { useEffect, useState, useCallback } from 'react';
import type { RunState } from '@/lib/gateway';
import { RunCard } from './run-card';
import { RefreshCw } from 'lucide-react';
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
    const [error,       setError]       = useState<string | null>(null);

    const fetchRuns = useCallback(async () => {
        try {
            const res = await fetch('/api/runs');
            if (!res.ok) { setError(`Gateway error ${res.status}`); return; }
            const data = await res.json() as RunState[];
            setRuns(data);
            setLastRefresh(new Date());
            setError(null);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchRuns();
        const interval = setInterval(fetchRuns, 3_000);
        return () => clearInterval(interval);
    }, [fetchRuns]);

    function runsForColumn(col: Column): RunState[] {
        return runs.filter(r => r.status === col.key || (col.extra && r.status === col.extra));
    }

    return (
        <div className="flex h-full flex-col overflow-hidden">
            {/* Toolbar */}
            <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-2.5">
                <span className="text-xs text-muted-foreground">
                    {loading
                        ? 'Loading…'
                        : error
                            ? <span className="text-red-400">Gateway unreachable — {error}</span>
                            : `${runs.length} run${runs.length !== 1 ? 's' : ''} · refreshed ${lastRefresh?.toLocaleTimeString()}`
                    }
                </span>
                <button
                    onClick={fetchRuns}
                    className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                    <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
                    Refresh
                </button>
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
                                            onRefresh={fetchRuns}
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
