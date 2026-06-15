'use client';

import { useState, useTransition } from 'react';
import { Plus, Pencil, Trash2, CheckCircle2, XCircle, Zap, Tag, Clock } from 'lucide-react';
import { cn } from '@/components/ui';
import { AgentFormDialog } from './agent-form-dialog';
import type { AgentConfig, AgentHealth } from '@/lib/gateway';
import { saveAgent, deleteAgent } from '@/lib/gateway';

// ── AgentCard ─────────────────────────────────────────────────────────────────

function AgentCard({
    agent, config,
    onEdit, onDelete,
}: {
    agent:    AgentHealth;
    config?:  AgentConfig;
    onEdit:   () => void;
    onDelete: () => void;
}) {
    const allOk     = agent.instances.every(i => i.ok);
    const anyOk     = agent.instances.some(i => i.ok);
    const overallOk = agent.instances.length > 0 && allOk;

    return (
        <div className={cn(
            'rounded-xl border bg-card p-4 transition-shadow hover:shadow-md',
            overallOk ? 'border-emerald-800/30' : anyOk ? 'border-amber-800/40' : 'border-red-800/40',
        )}>
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
                <div className="flex items-center gap-1 shrink-0">
                    <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {agent.strategy}
                    </span>
                    <button onClick={onEdit}   className="p-1.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-accent transition-colors"><Pencil  className="h-3.5 w-3.5" /></button>
                    <button onClick={onDelete} className="p-1.5 rounded text-muted-foreground/50 hover:text-red-400 hover:bg-red-950/20 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
            </div>

            {config && (config.capability || config.timeout) && (
                <div className="mt-2 flex flex-wrap gap-2 pl-6">
                    {config.capability && (
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
                            <Tag   className="h-3 w-3" /><span className="font-mono">{config.capability}</span>
                        </div>
                    )}
                    {config.timeout && (
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
                            <Clock className="h-3 w-3" /><span>{(config.timeout / 1000).toFixed(0)}s</span>
                        </div>
                    )}
                    {config.gate && (
                        <span className="rounded bg-amber-950/40 border border-amber-700/30 px-1.5 py-0.5 text-[10px] text-amber-400">gate</span>
                    )}
                </div>
            )}

            <div className="mt-3 space-y-1.5">
                {agent.instances.map(inst => (
                    <div key={inst.url} className="flex items-center gap-2 rounded-md bg-muted/20 px-2.5 py-1.5">
                        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', inst.ok ? 'bg-emerald-400' : 'bg-red-400')} />
                        <span className="flex-1 truncate font-mono text-[11px] text-muted-foreground">{inst.url}</span>
                        <span className={cn('text-[10px] font-medium',
                            inst.circuitState === 'closed' ? 'text-emerald-400' : inst.circuitState === 'open' ? 'text-red-400' : 'text-amber-400',
                        )}>{inst.circuitState}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── AgentsPanel ───────────────────────────────────────────────────────────────

interface AgentsPanelProps {
    agents:       AgentHealth[];
    agentConfigs: AgentConfig[];
}

export function AgentsPanel({ agents, agentConfigs }: AgentsPanelProps) {
    const [health,      setHealth]      = useState<AgentHealth[]>(agents);
    const [configs,     setConfigs]     = useState<AgentConfig[]>(agentConfigs);
    const [formOpen,    setFormOpen]    = useState(false);
    const [editTarget,  setEditTarget]  = useState<AgentConfig | undefined>();
    const [, startTransition]           = useTransition();

    const configMap = Object.fromEntries(configs.map(c => [c.id, c]));

    async function handleSave(agent: AgentConfig) {
        const res = await saveAgent(agent);
        if (!res.ok) throw new Error(res.error ?? 'Save failed');
        // Optimistic update
        setConfigs(cs => {
            const exists = cs.find(c => c.id === agent.id);
            return exists ? cs.map(c => c.id === agent.id ? agent : c) : [...cs, agent];
        });
        // Reload health in background
        startTransition(() => {
            fetch('/api/agents').then(r => r.json()).then((data: AgentHealth[]) => setHealth(data)).catch(() => {});
        });
    }

    async function handleDelete(id: string) {
        if (!confirm(`Delete agent "${id}"?`)) return;
        await deleteAgent(id);
        setConfigs(cs => cs.filter(c => c.id !== id));
        setHealth(h => h.filter(a => a.id !== id));
    }

    function openCreate() { setEditTarget(undefined); setFormOpen(true); }
    function openEdit(id: string) {
        const cfg = configMap[id];
        if (!cfg) return;
        const h = health.find(a => a.id === id);
        setEditTarget({
            ...cfg,
            instances: (h?.instances ?? cfg.instances ?? []).map(i => ({ url: (i as { url: string }).url })),
        });
        setFormOpen(true);
    }

    const okCount   = health.filter(a => a.instances.every(i => i.ok)).length;
    const downCount = health.length - okCount;

    return (
        <>
            <div className="space-y-4">
                {/* Summary + create button */}
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-3 text-xs flex-1">
                        <div className="flex items-center gap-1.5 text-emerald-400">
                            <Zap className="h-3.5 w-3.5" /><span>{okCount} healthy</span>
                        </div>
                        {downCount > 0 && (
                            <div className="flex items-center gap-1.5 text-red-400">
                                <XCircle className="h-3.5 w-3.5" /><span>{downCount} down</span>
                            </div>
                        )}
                    </div>
                    <button
                        onClick={openCreate}
                        className="flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
                    >
                        <Plus className="h-3.5 w-3.5" /> New agent
                    </button>
                </div>

                {/* Cards */}
                {health.length === 0 && configs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                        <p className="text-sm font-medium text-foreground">No agents configured</p>
                        <p className="text-xs text-muted-foreground">Create your first agent to get started.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {health.map(agent => (
                            <AgentCard
                                key={agent.id}
                                agent={agent}
                                config={configMap[agent.id]}
                                onEdit={() => openEdit(agent.id)}
                                onDelete={() => handleDelete(agent.id)}
                            />
                        ))}
                        {/* Agents in config but not yet in health (newly created, offline) */}
                        {configs.filter(c => !health.find(h => h.id === c.id)).map(c => (
                            <AgentCard
                                key={c.id}
                                agent={{ id: c.id, description: c.description ?? '', strategy: c.strategy, instances: [] }}
                                config={c}
                                onEdit={() => openEdit(c.id)}
                                onDelete={() => handleDelete(c.id)}
                            />
                        ))}
                    </div>
                )}
            </div>

            <AgentFormDialog
                open={formOpen}
                onClose={() => setFormOpen(false)}
                initial={editTarget}
                onSave={handleSave}
            />
        </>
    );
}
