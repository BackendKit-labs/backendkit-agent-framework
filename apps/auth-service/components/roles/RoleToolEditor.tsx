'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { DIRECTOR_TOOL_GROUPS, ALL_TOOLS } from '@/lib/tools';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ToolGroup { label: string; server?: string; tools: string[]; }
interface Registry {
    generated:       string | null;
    directorVersion: string | null;
    groups:          ToolGroup[];
    allTools:        string[];
    fallback?:       boolean;
}

interface Props {
    tools:    string[];
    onChange: (tools: string[]) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RoleToolEditor({ tools, onChange }: Props) {
    const [registry, setRegistry] = useState<Registry>({
        generated: null, directorVersion: null,
        groups: DIRECTOR_TOOL_GROUPS, allTools: ALL_TOOLS, fallback: true,
    });

    useEffect(() => {
        fetch('/api/director/tools')
            .then(r => r.json())
            .then((data: Registry) => setRegistry(data))
            .catch(() => { /* usa el fallback estático ya seteado */ });
    }, []);

    const set = new Set(tools);

    function toggle(tool: string) {
        const next = new Set(set);
        if (next.has(tool)) next.delete(tool); else next.add(tool);
        onChange([...next]);
    }

    function toggleGroup(groupTools: string[]) {
        const allOn = groupTools.every(t => set.has(t));
        const next  = new Set(set);
        groupTools.forEach(t => allOn ? next.delete(t) : next.add(t));
        onChange([...next]);
    }

    function selectAll() { onChange([...registry.allTools]); }
    function clearAll()  { onChange([]); }

    return (
        <div className="space-y-4">
            {/* Header con info del registry */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">
                        {tools.length} / {registry.allTools.length} tools seleccionadas
                    </p>
                    {registry.fallback ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-400/10 text-amber-400 border border-amber-400/20">
                            lista estática — levantá el director para sincronizar
                        </span>
                    ) : (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-400/10 text-emerald-400 border border-emerald-400/20">
                            sincronizado con el director
                            {registry.generated && ` · ${new Date(registry.generated).toLocaleTimeString('es')}`}
                        </span>
                    )}
                </div>
                <div className="flex gap-2">
                    <button type="button" onClick={selectAll}
                        className="text-xs text-primary hover:underline">Seleccionar todas</button>
                    <span className="text-muted-foreground">·</span>
                    <button type="button" onClick={clearAll}
                        className="text-xs text-muted-foreground hover:text-foreground hover:underline">Limpiar</button>
                </div>
            </div>

            {/* Grid de grupos */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {registry.groups.map(group => {
                    const allOn  = group.tools.every(t => set.has(t));
                    const someOn = group.tools.some(t => set.has(t));
                    return (
                        <div key={group.label} className="rounded-lg border border-border bg-secondary/30 p-3 space-y-2">
                            {/* Grupo header */}
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox"
                                    checked={allOn}
                                    ref={el => { if (el) el.indeterminate = someOn && !allOn; }}
                                    onChange={() => toggleGroup(group.tools)}
                                    className="w-3.5 h-3.5 rounded accent-primary" />
                                <span className={cn('text-xs font-semibold flex-1',
                                    allOn ? 'text-foreground' : someOn ? 'text-primary' : 'text-muted-foreground')}>
                                    {group.label}
                                </span>
                                <span className="text-[10px] text-muted-foreground shrink-0">
                                    {group.tools.filter(t => set.has(t)).length}/{group.tools.length}
                                </span>
                            </label>

                            {/* Tools individuales */}
                            <div className="space-y-1.5 pl-1">
                                {group.tools.map(tool => (
                                    <label key={tool} className="flex items-center gap-2 cursor-pointer">
                                        <input type="checkbox"
                                            checked={set.has(tool)}
                                            onChange={() => toggle(tool)}
                                            className="w-3 h-3 rounded accent-primary" />
                                        <span className={cn('text-xs font-mono',
                                            set.has(tool) ? 'text-foreground' : 'text-muted-foreground')}>
                                            {tool}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
