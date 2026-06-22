'use client';
import { Shield, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { Badge, cn } from '@/components/ui';
import { ROLE_COLORS, ROLE_LABELS } from '@/lib/permissions';
import type { UserRole } from '@/lib/permissions';

type UserRow = {
    id: string;
    email: string | null;
    name: string | null;
    role: string;
    active: boolean;
    lastActiveAt: string | null | undefined;
    createdAt: string;
};

interface UsersTableProps {
    users: UserRow[];
}

export function UsersTable({ users }: UsersTableProps) {
    return (
        <div className="space-y-4">
            {/* Stats */}
            <div className="flex gap-3">
                {(['admin', 'development', 'devops', 'hr', 'sales', 'finance', 'viewer'] as UserRole[]).map(role => {
                    const count = users.filter(u => u.role === role && u.active).length;
                    if (count === 0) return null;
                    return (
                        <div key={role} className={cn('flex items-center gap-2 rounded-lg border px-3 py-1.5', ROLE_COLORS[role])}>
                            <span className="text-sm font-bold">{count}</span>
                            <span className="text-xs">{ROLE_LABELS[role]}</span>
                        </div>
                    );
                })}
            </div>

            {/* Table */}
            <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-border bg-muted/30">
                            {['Usuario', 'Rol', 'Última actividad', 'Estado'].map(h => (
                                <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {users.map((user, i) => (
                            <tr
                                key={user.id}
                                className={cn(
                                    'border-b border-border/50',
                                    !user.active && 'opacity-50',
                                    i % 2 === 0 ? 'bg-background/40' : 'bg-background/20',
                                )}
                            >
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                                            {(user.name ?? user.email ?? '?').charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium">{user.name ?? '—'}</p>
                                            <p className="text-xs text-muted-foreground">{user.email ?? '—'}</p>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-4 py-3">
                                    <Badge className={cn('border text-xs', ROLE_COLORS[user.role as UserRole])}>
                                        <Shield className="mr-1 h-2.5 w-2.5" />
                                        {ROLE_LABELS[user.role as UserRole] ?? user.role}
                                    </Badge>
                                </td>
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <Clock className="h-3 w-3" />
                                        {user.lastActiveAt
                                            ? new Date(user.lastActiveAt).toLocaleDateString('es', { day: '2-digit', month: 'short' })
                                            : 'Nunca'}
                                    </div>
                                </td>
                                <td className="px-4 py-3">
                                    {user.active
                                        ? <div className="flex items-center gap-1.5 text-xs text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" />Activo</div>
                                        : <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><XCircle className="h-3.5 w-3.5" />Inactivo</div>
                                    }
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
