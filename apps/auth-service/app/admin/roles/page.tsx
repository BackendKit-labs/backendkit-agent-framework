'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Pencil, Trash2, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Role { id: string; name: string; label: string; description?: string; tools: string; active: boolean; }

export default function RolesPage() {
    const [roles, setRoles] = useState<Role[]>([]);
    const token = () => sessionStorage.getItem('auth_token') ?? '';

    async function load() {
        const res = await fetch('/api/roles', { headers: { Authorization: `Bearer ${token()}` } });
        setRoles(await res.json() as Role[]);
    }
    useEffect(() => { load(); }, []);

    async function remove(id: string, label: string) {
        if (!confirm(`¿Desactivar el rol "${label}"?`)) return;
        await fetch(`/api/roles/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } });
        load();
    }

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold">Roles</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Cada rol define qué herramientas del Director puede usar. Los usuarios heredan las tools del rol asignado.
                    </p>
                </div>
                <Link href="/admin/roles/new"
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
                    <Plus className="w-4 h-4" /> Nuevo rol
                </Link>
            </div>

            <div className="grid gap-4">
                {roles.map(r => {
                    const tools = JSON.parse(r.tools) as string[];
                    return (
                        <div key={r.id} className="rounded-xl border border-border bg-secondary/20 p-4">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-semibold">{r.label}</span>
                                        <code className="text-xs text-muted-foreground bg-accent px-1.5 py-0.5 rounded">{r.name}</code>
                                        <span className="text-xs text-muted-foreground">{tools.length} tools</span>
                                    </div>
                                    {r.description && <p className="text-sm text-muted-foreground mb-3">{r.description}</p>}
                                    <div className="flex flex-wrap gap-1">
                                        {tools.slice(0, 12).map(t => (
                                            <span key={t} className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-primary/10 text-primary">
                                                <CheckCircle2 className="w-2.5 h-2.5" /> {t}
                                            </span>
                                        ))}
                                        {tools.length > 12 && (
                                            <span className="px-2 py-0.5 rounded-md text-xs bg-accent text-muted-foreground">
                                                +{tools.length - 12} más
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <Link href={`/admin/roles/${r.id}`}
                                        className="p-2 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
                                        <Pencil className="w-4 h-4" />
                                    </Link>
                                    <button onClick={() => remove(r.id, r.label)}
                                        className="p-2 rounded-lg hover:bg-red-400/10 text-muted-foreground hover:text-red-400 transition-colors">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
