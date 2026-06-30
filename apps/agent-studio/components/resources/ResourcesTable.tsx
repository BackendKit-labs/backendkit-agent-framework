'use client';

import { useState, useTransition, useCallback } from 'react';
import type { DepartmentResource } from '@/lib/abac';
import { addDepartmentResource, removeDepartmentResource } from '@/lib/abac';
import { Trash2, Plus, Loader2 } from 'lucide-react';

const DEPARTMENTS = ['development', 'devops', 'sales', 'finance', 'hr'];

interface Props {
    initialResources: DepartmentResource[];
}

export function ResourcesTable({ initialResources }: Props) {
    const [resources, setResources] = useState<DepartmentResource[]>(initialResources);
    const [filterDept, setFilterDept] = useState<string>('');
    const [isPending, startTransition] = useTransition();

    // Add form state
    const [form, setForm] = useState({ department: '', uriPattern: '', description: '' });
    const [formError, setFormError] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);

    const filtered = filterDept
        ? resources.filter(r => r.department === filterDept)
        : resources;

    const grouped = filtered.reduce<Record<string, DepartmentResource[]>>((acc, r) => {
        (acc[r.department] ??= []).push(r);
        return acc;
    }, {});

    const handleAdd = useCallback(async () => {
        if (!form.department || !form.uriPattern) {
            setFormError('Department y URI Pattern son requeridos.');
            return;
        }
        setFormError(null);
        setAdding(true);
        try {
            const created = await addDepartmentResource(
                form.department,
                form.uriPattern,
                form.description || undefined,
            );
            setResources(prev => [...prev, created]);
            setForm({ department: '', uriPattern: '', description: '' });
        } catch (e) {
            setFormError(e instanceof Error ? e.message : 'Error al agregar recurso');
        } finally {
            setAdding(false);
        }
    }, [form]);

    const handleRemove = useCallback((id: string) => {
        if (!confirm('¿Desactivar este URI pattern?')) return;
        startTransition(async () => {
            try {
                await removeDepartmentResource(id);
                setResources(prev => prev.filter(r => r.id !== id));
            } catch {
                // ignore — user can retry
            }
        });
    }, []);

    return (
        <div className="space-y-6">
            {/* Filter + Add */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                {/* Filter */}
                <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Filtrar por department
                    </label>
                    <select
                        value={filterDept}
                        onChange={e => setFilterDept(e.target.value)}
                        className="h-9 rounded-md border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                        <option value="">Todos</option>
                        {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                </div>
            </div>

            {/* Add form */}
            <div className="rounded-lg border border-border bg-card p-4">
                <p className="mb-3 text-sm font-medium text-foreground">Agregar URI Pattern</p>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="flex flex-col gap-1 flex-1">
                        <label className="text-xs text-muted-foreground">Department *</label>
                        <select
                            value={form.department}
                            onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                            <option value="">Seleccionar...</option>
                            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                    </div>
                    <div className="flex flex-col gap-1 flex-[2]">
                        <label className="text-xs text-muted-foreground">URI Pattern *</label>
                        <input
                            type="text"
                            value={form.uriPattern}
                            onChange={e => setForm(f => ({ ...f, uriPattern: e.target.value }))}
                            placeholder="jira://* ó hubspot://contacts/*"
                            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                    </div>
                    <div className="flex flex-col gap-1 flex-[2]">
                        <label className="text-xs text-muted-foreground">Descripción</label>
                        <input
                            type="text"
                            value={form.description}
                            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                            placeholder="Opcional"
                            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                    </div>
                    <button
                        onClick={handleAdd}
                        disabled={adding}
                        className="flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
                    >
                        {adding
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Plus className="h-3.5 w-3.5" />}
                        Agregar
                    </button>
                </div>
                {formError && (
                    <p className="mt-2 text-xs text-destructive">{formError}</p>
                )}
            </div>

            {/* Resource list grouped by department */}
            {Object.keys(grouped).length === 0 ? (
                <div className="rounded-lg border border-border bg-card/50 py-16 text-center">
                    <p className="text-sm text-muted-foreground">No hay resources configurados.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([dept, rows]) => (
                        <section key={dept} className="rounded-lg border border-border bg-card overflow-hidden">
                            <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
                                <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{dept}</span>
                                <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{rows.length}</span>
                            </div>
                            <table className="w-full text-sm">
                                <tbody className="divide-y divide-border">
                                    {rows.map(r => (
                                        <tr key={r.id} className="group hover:bg-muted/20 transition-colors">
                                            <td className="px-4 py-2.5 font-mono text-xs text-foreground">{r.uriPattern}</td>
                                            <td className="px-4 py-2.5 text-muted-foreground text-xs hidden sm:table-cell">{r.description ?? '—'}</td>
                                            <td className="px-4 py-2.5 w-10 text-right">
                                                <button
                                                    onClick={() => handleRemove(r.id)}
                                                    disabled={isPending}
                                                    title="Desactivar pattern"
                                                    className="invisible group-hover:visible rounded p-1 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </section>
                    ))}
                </div>
            )}
        </div>
    );
}
