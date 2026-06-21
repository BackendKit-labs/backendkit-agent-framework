'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, UserPlus } from 'lucide-react';
import Link from 'next/link';
import type { Role } from '@/db/schema';
import { cn } from '@/lib/utils';

interface Dept { id: string; name: string; }

export default function NewUserPage() {
    const router = useRouter();
    const [form,  setForm]  = useState({ username: '', name: '', email: '', password: '', role: 'viewer', department: '' });
    const [apps,  setApps]  = useState({ canUseDirector: true, canUseVault: false });
    const [depts, setDepts] = useState<Dept[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);

    useEffect(() => {
        fetch('/api/departments').then(r => r.json()).then(setDepts).catch(() => {});
        fetch('/api/roles').then(r => r.json()).then(setRoles).catch(() => {});
    }, []);
    const [error, setError] = useState('');
    const [saving, setSave] = useState(false);

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        if (!form.username || !form.password || !form.role) { setError('Username, contraseña y rol son requeridos'); return; }
        setSave(true); setError('');
        const token = sessionStorage.getItem('auth_token');
        const res = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ ...form, ...apps, name: form.name || undefined, email: form.email || undefined, department: form.department || undefined }),
        });
        const data = await res.json() as { error?: string };
        if (!res.ok) { setError(data.error ?? 'Error'); setSave(false); return; }
        router.push('/admin/users');
    }

    return (
        <div className="max-w-lg space-y-6 animate-fade-in">
            <div className="flex items-center gap-3">
                <Link href="/admin/users" className="p-2 rounded-lg hover:bg-accent text-muted-foreground transition-colors">
                    <ArrowLeft className="w-4 h-4" />
                </Link>
                <div>
                    <h1 className="text-xl font-semibold">Nuevo usuario</h1>
                    <p className="text-sm text-muted-foreground">El workspace se configura después de crear el usuario</p>
                </div>
            </div>

            <form onSubmit={submit} className="rounded-xl border border-border bg-secondary/20 p-5 space-y-4">
                {[
                    { key: 'username',   label: 'Username *',     type: 'text',     ph: 'maria.garcia' },
                    { key: 'name',     label: 'Nombre',       type: 'text',     ph: 'María García' },
                    { key: 'email',    label: 'Email',        type: 'email',    ph: 'maria@empresa.com' },
                    { key: 'password', label: 'Contraseña *', type: 'password', ph: '' },
                ].map(({ key, label, type, ph }) => (
                    <div key={key} className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">{label}</label>
                        <input type={type} value={form[key as keyof typeof form]} placeholder={ph}
                            onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                            className="w-full px-3 py-2 rounded-lg text-sm bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/40" />
                    </div>
                ))}

                <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Departamento</label>
                    <select value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg text-sm bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/40">
                        <option value="">— Sin departamento —</option>
                        {depts.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                    </select>
                </div>

                <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Rol *</label>
                    <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg text-sm bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/40">
                        <option value="">— Seleccionar rol —</option>
                        {roles.map(r => (
                            <option key={r.id} value={r.name}>{r.label} ({r.name})</option>
                        ))}
                    </select>
                </div>

                <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">Acceso a aplicaciones</label>
                    <div className="rounded-lg border border-border bg-secondary/50 p-3 space-y-2">
                        {[
                            { key: 'canUseDirector', label: 'Director Chat', desc: 'Interfaz conversacional del ecosistema' },
                            { key: 'canUseVault',    label: 'Vault Manager', desc: 'Gestión de conocimiento y documentación' },
                        ].map(({ key, label, desc }) => (
                            <label key={key} className="flex items-center gap-3 cursor-pointer">
                                <input type="checkbox"
                                    checked={apps[key as keyof typeof apps]}
                                    onChange={e => setApps(a => ({ ...a, [key]: e.target.checked }))}
                                    className="w-4 h-4 rounded accent-primary shrink-0" />
                                <div>
                                    <p className="text-sm font-medium">{label}</p>
                                    <p className="text-xs text-muted-foreground">{desc}</p>
                                </div>
                            </label>
                        ))}
                    </div>
                </div>

                {error && <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>}

                <button type="submit" disabled={saving} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                    <UserPlus className="w-4 h-4" /> {saving ? 'Creando...' : 'Crear usuario'}
                </button>
            </form>
        </div>
    );
}
