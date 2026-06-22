'use client';

import { useEffect, useState } from 'react';
import { Users, UserCheck, UserX, ShieldAlert } from 'lucide-react';
import { cn, roleBg } from '@/lib/utils';
import { ROLES } from '@/db/schema';

interface UserRow { id: string; username: string; role: string; active: boolean; lockedUntil: string | null; directorTools: string | null; createdAt: string; }

export default function DashboardPage() {
    const [users, setUsers] = useState<UserRow[]>([]);

    useEffect(() => {
        const token = sessionStorage.getItem('auth_token');
        fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } })
            .then(r => r.json()).then(setUsers).catch(() => {});
    }, []);

    const active   = users.filter(u => u.active).length;
    const inactive = users.filter(u => !u.active).length;
    const custom   = users.filter(u => u.directorTools !== null).length;
    const byRole   = ROLES.map(r => ({ role: r, count: users.filter(u => u.role === r).length })).filter(r => r.count > 0);

    const stats = [
        { label: 'Usuarios totales',  value: users.length, icon: Users,       color: 'text-primary' },
        { label: 'Activos',           value: active,        icon: UserCheck,   color: 'text-emerald-400' },
        { label: 'Inactivos',         value: inactive,      icon: UserX,       color: 'text-red-400' },
        { label: 'Con workspace custom', value: custom, icon: ShieldAlert, color: 'text-amber-400' },
    ];

    return (
        <div className="space-y-6 animate-fade-in">
            <div>
                <h1 className="text-xl font-semibold">Dashboard</h1>
                <p className="text-sm text-muted-foreground mt-1">Gestión de usuarios del ecosistema BackendKit</p>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {stats.map(s => (
                    <div key={s.label} className="rounded-xl border border-border bg-secondary/30 p-4">
                        <div className="flex items-center gap-3 mb-3">
                            <div className={cn('w-8 h-8 rounded-lg bg-current/10 flex items-center justify-center', s.color)}>
                                <s.icon className={cn('w-4 h-4', s.color)} />
                            </div>
                        </div>
                        <p className="text-2xl font-bold">{s.value}</p>
                        <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
                    </div>
                ))}
            </div>

            <div className="rounded-xl border border-border bg-secondary/30 p-4">
                <h2 className="text-sm font-semibold mb-4">Distribución por rol</h2>
                <div className="flex flex-wrap gap-2">
                    {byRole.map(({ role, count }) => (
                        <div key={role} className={cn('px-3 py-1.5 rounded-lg border text-sm font-medium', roleBg(role))}>
                            {role} <span className="opacity-60 ml-1">({count})</span>
                        </div>
                    ))}
                    {byRole.length === 0 && <p className="text-sm text-muted-foreground">Sin usuarios aún</p>}
                </div>
            </div>
        </div>
    );
}
