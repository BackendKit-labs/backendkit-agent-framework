'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Pencil, UserX, UserCheck, Lock } from 'lucide-react';
import { cn, roleBg } from '@/lib/utils';

interface UserRow {
    id: string; username: string; name?: string; email?: string;
    role: string; department?: string; active: boolean;
    failedAttempts: number; lockedUntil?: string;
    directorTools?: string; canUseDirector: boolean; canUseVault: boolean;
    createdAt: string;
}

export default function UsersPage() {
    const [users, setUsers] = useState<UserRow[]>([]);
    const [loading, setLoad] = useState(true);

    async function load() {
        const token = sessionStorage.getItem('auth_token');
        const res = await fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } });
        setUsers(await res.json() as UserRow[]);
        setLoad(false);
    }

    useEffect(() => { load(); }, []);

    async function toggle(id: string, active: boolean) {
        const token = sessionStorage.getItem('auth_token');
        await fetch(`/api/users/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ active }),
        });
        load();
    }

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold">Usuarios</h1>
                    <p className="text-sm text-muted-foreground mt-1">{users.length} usuarios registrados</p>
                </div>
                <Link href="/admin/users/new" className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
                    <Plus className="w-4 h-4" /> Nuevo usuario
                </Link>
            </div>

            <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-secondary/50 border-b border-border">
                        <tr>
                            {['Usuario', 'Rol', 'Departamento', 'Apps', 'Workspace', 'Estado', ''].map(h => (
                                <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {loading ? (
                            <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Cargando...</td></tr>
                        ) : users.map(u => (
                            <tr key={u.id} className={cn('hover:bg-accent/20 transition-colors', !u.active && 'opacity-50')}>
                                <td className="px-4 py-3">
                                    <div className="font-medium">{u.username}</div>
                                    {u.name && <div className="text-xs text-muted-foreground">{u.name}</div>}
                                    {u.email && <div className="text-xs text-muted-foreground">{u.email}</div>}
                                </td>
                                <td className="px-4 py-3">
                                    <span className={cn('px-2 py-0.5 rounded-md text-xs font-medium border', roleBg(u.role))}>{u.role}</span>
                                </td>
                                <td className="px-4 py-3 text-muted-foreground">{u.department ?? '—'}</td>
                                <td className="px-4 py-3">
                                    <div className="flex gap-1 flex-wrap">
                                        {u.canUseDirector && <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-400/10 text-blue-400">Director</span>}
                                        {u.canUseVault    && <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-400/10 text-purple-400">Vault</span>}
                                    </div>
                                </td>
                                <td className="px-4 py-3">
                                    {u.directorTools
                                        ? <span className="text-xs text-amber-400">Custom ({JSON.parse(u.directorTools).length} tools)</span>
                                        : <span className="text-xs text-muted-foreground">Default del rol</span>}
                                </td>
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-1.5">
                                        {u.lockedUntil && new Date(u.lockedUntil) > new Date()
                                            ? <span className="flex items-center gap-1 text-xs text-red-400"><Lock className="w-3 h-3" />Bloqueado</span>
                                            : u.active
                                                ? <span className="flex items-center gap-1 text-xs text-emerald-400"><UserCheck className="w-3 h-3" />Activo</span>
                                                : <span className="flex items-center gap-1 text-xs text-zinc-400"><UserX className="w-3 h-3" />Inactivo</span>}
                                        {u.failedAttempts > 0 && <span className="text-xs text-amber-400">({u.failedAttempts} intentos)</span>}
                                    </div>
                                </td>
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-2">
                                        <Link href={`/admin/users/${u.id}`} className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
                                            <Pencil className="w-3.5 h-3.5" />
                                        </Link>
                                        <button onClick={() => toggle(u.id, !u.active)} className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
                                            {u.active ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                                        </button>
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
