'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { RoleToolEditor } from '@/components/roles/RoleToolEditor';

interface Role { id: string; name: string; label: string; description?: string; tools: string; }

export default function EditRolePage({ params }: { params: { id: string } }) {
    const router = useRouter();
    const [role,  setRole]  = useState<Role | null>(null);
    const [form,  setForm]  = useState({ label: '', description: '' });
    const [tools, setTools] = useState<string[]>([]);
    const [saving, setSave] = useState(false);
    const [msg,   setMsg]   = useState('');

    useEffect(() => {
        const token = sessionStorage.getItem('auth_token');
        fetch(`/api/roles/${params.id}`, { headers: { Authorization: `Bearer ${token}` } })
            .then(r => r.json()).then((r: Role) => {
                setRole(r);
                setForm({ label: r.label, description: r.description ?? '' });
                setTools(JSON.parse(r.tools) as string[]);
            });
    }, [params.id]);

    async function save() {
        setSave(true); setMsg('');
        const token = sessionStorage.getItem('auth_token');
        await fetch(`/api/roles/${params.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ label: form.label, description: form.description || null, tools }),
        });
        setSave(false); setMsg('Guardado ✓');
        setTimeout(() => setMsg(''), 2000);
    }

    if (!role) return <div className="text-muted-foreground p-6">Cargando...</div>;

    return (
        <div className="space-y-6 animate-fade-in max-w-4xl">
            <div className="flex items-center gap-3">
                <Link href="/admin/roles" className="p-2 rounded-lg hover:bg-accent text-muted-foreground transition-colors">
                    <ArrowLeft className="w-4 h-4" />
                </Link>
                <div>
                    <h1 className="text-xl font-semibold">
                        {role.label} <code className="text-sm text-muted-foreground font-mono bg-accent px-1.5 py-0.5 rounded">{role.name}</code>
                    </h1>
                    <p className="text-sm text-muted-foreground">Editá las herramientas asignadas a este rol</p>
                </div>
            </div>

            <div className="rounded-xl border border-border bg-secondary/20 p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Etiqueta</label>
                    <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                        className={cn('w-full px-3 py-2 rounded-lg text-sm bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/40')} />
                </div>
                <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Descripción</label>
                    <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                        className={cn('w-full px-3 py-2 rounded-lg text-sm bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/40')} />
                </div>
            </div>

            <div className="rounded-xl border border-border bg-secondary/20 p-4 space-y-4">
                <h2 className="text-sm font-semibold">Herramientas asignadas a este rol</h2>
                <p className="text-xs text-muted-foreground">
                    Los usuarios con este rol heredan estas herramientas. Podés sobreescribirlas por usuario en la sección de workspace avanzado.
                </p>
                <RoleToolEditor tools={tools} onChange={setTools} />
            </div>

            <div className="flex items-center gap-3">
                <button onClick={save} disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                    <Save className="w-4 h-4" /> {saving ? 'Guardando...' : 'Guardar cambios'}
                </button>
                {msg && <span className="text-sm text-emerald-400">{msg}</span>}
            </div>
        </div>
    );
}
