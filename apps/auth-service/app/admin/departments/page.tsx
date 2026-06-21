'use client';

import { useEffect, useState } from 'react';
import { Plus, Pencil, Check, X, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Dept { id: string; name: string; description?: string; active: boolean; }

export default function DepartmentsPage() {
    const [depts,   setDepts]   = useState<Dept[]>([]);
    const [newName, setNewName] = useState('');
    const [newDesc, setNewDesc] = useState('');
    const [editId,  setEditId]  = useState<string | null>(null);
    const [editVal, setEditVal] = useState({ name: '', description: '' });
    const [saving,  setSaving]  = useState(false);
    const [error,   setError]   = useState('');

    const token = () => sessionStorage.getItem('auth_token') ?? '';

    async function load() {
        const res = await fetch('/api/departments', { headers: { Authorization: `Bearer ${token()}` } });
        const all = await res.json() as Dept[];
        setDepts(all);
    }
    useEffect(() => { load(); }, []);

    async function create(e: React.FormEvent) {
        e.preventDefault();
        if (!newName.trim()) return;
        setSaving(true); setError('');
        const res = await fetch('/api/departments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
            body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || undefined }),
        });
        const data = await res.json() as { error?: string };
        if (!res.ok) { setError(data.error ?? 'Error'); } else { setNewName(''); setNewDesc(''); load(); }
        setSaving(false);
    }

    async function update(id: string) {
        await fetch(`/api/departments/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
            body: JSON.stringify(editVal),
        });
        setEditId(null);
        load();
    }

    async function remove(id: string, name: string) {
        if (!confirm(`¿Desactivar el departamento "${name}"?`)) return;
        await fetch(`/api/departments/${id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token()}` },
        });
        load();
    }

    return (
        <div className="space-y-6 animate-fade-in max-w-2xl">
            <div>
                <h1 className="text-xl font-semibold">Departamentos</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Definí los departamentos de la empresa. Los usuarios los seleccionan al crear su perfil.
                </p>
            </div>

            {/* Crear nuevo */}
            <form onSubmit={create} className="rounded-xl border border-border bg-secondary/20 p-4 space-y-3">
                <h2 className="text-sm font-semibold">Nuevo departamento</h2>
                <div className="flex gap-2">
                    <input value={newName} onChange={e => setNewName(e.target.value)}
                        placeholder="Nombre del departamento *"
                        className={cn('flex-1 px-3 py-2 rounded-lg text-sm bg-secondary border border-border',
                            'focus:outline-none focus:ring-2 focus:ring-primary/40')} />
                    <button type="submit" disabled={saving || !newName.trim()}
                        className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5">
                        <Plus className="w-4 h-4" /> Agregar
                    </button>
                </div>
                <input value={newDesc} onChange={e => setNewDesc(e.target.value)}
                    placeholder="Descripción (opcional)"
                    className={cn('w-full px-3 py-2 rounded-lg text-sm bg-secondary border border-border',
                        'focus:outline-none focus:ring-2 focus:ring-primary/40')} />
                {error && <p className="text-sm text-red-400">{error}</p>}
            </form>

            {/* Lista */}
            <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-secondary/50 border-b border-border">
                        <tr>
                            <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Departamento</th>
                            <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Descripción</th>
                            <th className="px-4 py-3 w-24"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {depts.length === 0 && (
                            <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground text-sm">Sin departamentos</td></tr>
                        )}
                        {depts.map(d => (
                            <tr key={d.id} className="hover:bg-accent/20 transition-colors">
                                <td className="px-4 py-3">
                                    {editId === d.id
                                        ? <input value={editVal.name} onChange={e => setEditVal(v => ({ ...v, name: e.target.value }))}
                                            className="px-2 py-1 rounded bg-secondary border border-border text-sm w-full focus:outline-none focus:ring-1 focus:ring-primary/40" />
                                        : <span className="font-medium">{d.name}</span>}
                                </td>
                                <td className="px-4 py-3 text-muted-foreground">
                                    {editId === d.id
                                        ? <input value={editVal.description} onChange={e => setEditVal(v => ({ ...v, description: e.target.value }))}
                                            placeholder="Descripción"
                                            className="px-2 py-1 rounded bg-secondary border border-border text-sm w-full focus:outline-none focus:ring-1 focus:ring-primary/40" />
                                        : (d.description ?? '—')}
                                </td>
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-1 justify-end">
                                        {editId === d.id ? (
                                            <>
                                                <button onClick={() => update(d.id)} className="p-1.5 rounded hover:bg-emerald-400/10 text-emerald-400 transition-colors">
                                                    <Check className="w-3.5 h-3.5" />
                                                </button>
                                                <button onClick={() => setEditId(null)} className="p-1.5 rounded hover:bg-accent text-muted-foreground transition-colors">
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <button onClick={() => { setEditId(d.id); setEditVal({ name: d.name, description: d.description ?? '' }); }}
                                                    className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
                                                    <Pencil className="w-3.5 h-3.5" />
                                                </button>
                                                <button onClick={() => remove(d.id, d.name)}
                                                    className="p-1.5 rounded hover:bg-red-400/10 text-muted-foreground hover:text-red-400 transition-colors">
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
