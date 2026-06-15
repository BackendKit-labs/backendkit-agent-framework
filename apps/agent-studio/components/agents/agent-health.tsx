import type { AgentHealth } from '@/lib/gateway';
import { cn } from '@/lib/utils';
import { CheckCircle2, XCircle, Zap, Users } from 'lucide-react';

interface AgentHealthCardProps {
    agent: AgentHealth;
}

export function AgentHealthCard({ agent }: AgentHealthCardProps) {
    const allOk    = agent.instances.every(i => i.ok);
    const anyOk    = agent.instances.some(i => i.ok);
    const overallOk = agent.instances.length === 0 ? false : allOk;

    return (
        <div className={cn(
            'rounded-xl border bg-card p-4 transition-shadow hover:shadow-md',
            overallOk ? 'border-emerald-800/30' : anyOk ? 'border-amber-800/40' : 'border-red-800/40',
        )}>
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        {overallOk
                            ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                            : <XCircle      className="h-4 w-4 shrink-0 text-red-400" />
                        }
                        <h3 className="truncate font-semibold text-foreground">{agent.id}</h3>
                    </div>
                    {agent.description && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground pl-6">{agent.description}</p>
                    )}
                </div>
                <span className="shrink-0 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {agent.strategy}
                </span>
            </div>

            {/* Instances */}
            <div className="mt-3 space-y-1.5">
                {agent.instances.length === 0 ? (
                    <p className="text-xs text-muted-foreground/60">No instances configured</p>
                ) : (
                    agent.instances.map(inst => (
                        <div key={inst.url} className="flex items-center gap-2 rounded-md bg-muted/20 px-2.5 py-1.5">
                            <span className={cn(
                                'h-1.5 w-1.5 shrink-0 rounded-full',
                                inst.ok ? 'bg-emerald-400' : 'bg-red-400',
                            )} />
                            <span className="flex-1 truncate font-mono text-[11px] text-muted-foreground">
                                {inst.url}
                            </span>
                            <span className={cn(
                                'text-[10px] font-medium',
                                inst.circuitState === 'closed' ? 'text-emerald-400'
                                    : inst.circuitState === 'open'  ? 'text-red-400'
                                    : 'text-amber-400',
                            )}>
                                {inst.circuitState}
                            </span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

interface AgentGridProps {
    agents: AgentHealth[];
}

export function AgentGrid({ agents }: AgentGridProps) {
    if (agents.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/40">
                    <Users className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                    <p className="text-sm font-medium text-foreground">No agents found</p>
                    <p className="mt-1 text-xs text-muted-foreground">Make sure the gateway is running and agents are registered.</p>
                </div>
            </div>
        );
    }

    const okCount   = agents.filter(a => a.instances.every(i => i.ok)).length;
    const downCount = agents.length - okCount;

    return (
        <div className="space-y-4">
            {/* Summary bar */}
            <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5 text-emerald-400">
                    <Zap className="h-3.5 w-3.5" />
                    <span>{okCount} healthy</span>
                </div>
                {downCount > 0 && (
                    <div className="flex items-center gap-1.5 text-red-400">
                        <XCircle className="h-3.5 w-3.5" />
                        <span>{downCount} down</span>
                    </div>
                )}
            </div>

            {/* Cards grid */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {agents.map(agent => (
                    <AgentHealthCard key={agent.id} agent={agent} />
                ))}
            </div>
        </div>
    );
}
