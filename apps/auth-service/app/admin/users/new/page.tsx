'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { ROLES } from '@/db/schema';
import { cn } from '@/lib/utils';

export default function NewUserPage() {
    const router = useRouter();
    const [form, setForm] = useState({ username: '', name: '', email: '', password: '', role: 'viewer', department: '' });
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
            body: JSON.stringify({ ...form, name: form.name || undefined, email: form.email || undefined, department: form.department || undefined }),
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
                    { key: 'name',       label: 'Nombre',         type: 'text',     ph: 'María García' },
                    { key: 'email',      label: 'Email',          type: 'email',    ph: 'maria@empresa.com' },
                    { key: 'password',   label: 'Contraseña *',   type: 'password', ph: '' },
                    { key: 'department', label: 'Departamento',   type: 'text',     ph: 'people / engineering / ops' },
                ].map(({ key, label, type, ph }) => (
                    <div key={key} className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">{label}</label>
                        <input type={type} value={form[key as keyof typeof form]} placeholder={ph}
                            onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                            className="w-full px-3 py-2 rounded-lg text-sm bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/40" />
                    </div>
                ))}

                <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Rol *</label>
                    <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg text-sm bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/40">
                        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                </div>

                {error && <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>}

                <button type="submit" disabled={saving} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                    <UserPlus className="w-4 h-4" /> {saving ? 'Creando...' : 'Crear usuario'}
                </button>
            </form>
        </div>
    );
}
