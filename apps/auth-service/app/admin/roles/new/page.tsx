'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { RoleToolEditor } from '@/components/roles/RoleToolEditor';

export default function NewRolePage() {
    const router = useRouter();
    const [form,  setForm]  = useState({ name: '', label: '', description: '' });
    const [tools, setTools] = useState<string[]>([]);
    const [error, setError] = useState('');
    const [saving, setSave] = useState(false);

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        if (!form.name.trim() || !form.label.trim()) { setError('Nombre técnico y etiqueta son requeridos'); return; }
        setSave(true); setError('');
        const token = sessionStorage.getItem('auth_token');
        const res = await fetch('/api/roles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ ...form, tools }),
        });
        const data = await res.json() as { error?: string };
        if (!res.ok) { setError(data.error ?? 'Error'); setSave(false); return; }
        router.push('/admin/roles');
    }

    return (
        <form onSubmit={submit} className="space-y-6 animate-fade-in max-w-4xl">
            <div className="flex items-center gap-3">
                <Link href="/admin/roles" className="p-2 rounded-lg hover:bg-accent text-muted-foreground transition-colors">
                    <ArrowLeft className="w-4 h-4" />
                </Link>
                <p className="text-sm text-muted-foreground">Definí el nombre y las herramientas que tendrá este rol</p>
            </div>

            <div className="rounded-xl border border-border bg-secondary/20 p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Nombre técnico * <span className="text-[10px]">(ej: hr, sales)</span></label>
                    <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value.toLowerCase().replace(/\s+/g, '-') }))}
                        placeholder="hr" className={cn('w-full px-3 py-2 rounded-lg text-sm bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono')} />
                </div>
                <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Etiqueta * <span className="text-[10px]">(nombre visible)</span></label>
                    <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                        placeholder="Recursos Humanos" className={cn('w-full px-3 py-2 rounded-lg text-sm bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/40')} />
                </div>
                <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Descripción</label>
                    <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                        placeholder="Flows de RR.HH. y onboarding" className={cn('w-full px-3 py-2 rounded-lg text-sm bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/40')} />
                </div>
            </div>

            <div className="rounded-xl border border-border bg-secondary/20 p-4 space-y-4">
                <h2 className="text-sm font-semibold">Herramientas del Director</h2>
                <RoleToolEditor tools={tools} onChange={setTools} />
            </div>

            {error && <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>}

            <button type="submit" disabled={saving}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                <Save className="w-4 h-4" /> {saving ? 'Guardando...' : 'Crear rol'}
            </button>
        </form>
    );
}
