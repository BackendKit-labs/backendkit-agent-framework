'use client';

import { DIRECTOR_TOOL_GROUPS, ALL_TOOLS } from '@/lib/tools';
import { cn } from '@/lib/utils';

interface Props {
    tools:    string[];
    onChange: (tools: string[]) => void;
}

export function RoleToolEditor({ tools, onChange }: Props) {
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

    function selectAll()   { onChange([...ALL_TOOLS]); }
    function clearAll()    { onChange([]); }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{tools.length} / {ALL_TOOLS.length} tools seleccionadas</p>
                <div className="flex gap-2">
                    <button type="button" onClick={selectAll}
                        className="text-xs text-primary hover:underline">Seleccionar todas</button>
                    <span className="text-muted-foreground">·</span>
                    <button type="button" onClick={clearAll}
                        className="text-xs text-muted-foreground hover:text-foreground hover:underline">Limpiar</button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {DIRECTOR_TOOL_GROUPS.map(group => {
                    const allOn  = group.tools.every(t => set.has(t));
                    const someOn = group.tools.some(t => set.has(t));
                    return (
                        <div key={group.label} className="rounded-lg border border-border bg-secondary/30 p-3 space-y-2">
                            {/* Grupo header con checkbox de grupo */}
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <input type="checkbox"
                                    checked={allOn}
                                    ref={el => { if (el) el.indeterminate = someOn && !allOn; }}
                                    onChange={() => toggleGroup(group.tools)}
                                    className="w-3.5 h-3.5 rounded accent-primary" />
                                <span className={cn('text-xs font-semibold', allOn ? 'text-foreground' : someOn ? 'text-primary' : 'text-muted-foreground')}>
                                    {group.label}
                                </span>
                                <span className="text-[10px] text-muted-foreground ml-auto">
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
                                        <span className={cn('text-xs font-mono', set.has(tool) ? 'text-foreground' : 'text-muted-foreground')}>
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
