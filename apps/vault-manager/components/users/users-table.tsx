'use client';
import { useState } from 'react';
import { UserPlus, MoreHorizontal, Shield, User, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { Button, Badge, Dialog, DialogContent, DialogHeader, DialogTitle, Input, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, cn } from '@/components/ui';
import { ROLE_COLORS, ROLE_LABELS } from '@/lib/permissions';
import type { UserRole } from '@/lib/permissions';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

type UserRow = Pick<UserType, 'id' | 'email' | 'name' | 'role' | 'active' | 'lastActiveAt' | 'createdAt'>;

interface UsersTableProps {
    users: UserRow[];
}

export function UsersTable({ users: initialUsers }: UsersTableProps) {
    const [users,       setUsers]       = useState(initialUsers);
    const [inviteOpen,  setInviteOpen]  = useState(false);
    const [inviteName,  setInviteName]  = useState('');
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole,  setInviteRole]  = useState<UserRole>('viewer');
    const [invitePass,  setInvitePass]  = useState('');
    const [saving,      setSaving]      = useState(false);

    async function createUser() {
        setSaving(true);
        const res  = await fetch('/api/users', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ name: inviteName, email: inviteEmail, role: inviteRole, password: invitePass }),
        });
        if (res.ok) {
            const { user } = await res.json();
            setUsers(prev => [...prev, user]);
            setInviteOpen(false);
            setInviteName(''); setInviteEmail(''); setInvitePass('');
        }
        setSaving(false);
    }

    async function toggleActive(id: string, active: boolean) {
        await fetch(`/api/users/${id}`, {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ active: !active }),
        });
        setUsers(prev => prev.map(u => u.id === id ? { ...u, active: !active } : u));
    }

    async function changeRole(id: string, role: UserRole) {
        await fetch(`/api/users/${id}`, {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ role }),
        });
        setUsers(prev => prev.map(u => u.id === id ? { ...u, role } : u));
    }

    return (
        <div className="space-y-4">
            {/* Header row */}
            <div className="flex items-center justify-between">
                <div className="flex gap-3">
                    {(['admin', 'technical', 'business', 'viewer'] as UserRole[]).map(role => {
                        const count = users.filter(u => u.role === role && u.active).length;
                        return (
                            <div key={role} className={cn('flex items-center gap-2 rounded-lg border px-3 py-1.5', ROLE_COLORS[role])}>
                                <span className="text-sm font-bold">{count}</span>
                                <span className="text-xs">{ROLE_LABELS[role]}</span>
                            </div>
                        );
                    })}
                </div>
                <Button className="gap-2" onClick={() => setInviteOpen(true)}>
                    <UserPlus className="h-4 w-4" />
                    Nuevo usuario
                </Button>
            </div>

            {/* Table */}
            <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-border bg-muted/30">
                            {['Usuario', 'Rol', 'Acceso a vaults', 'Última actividad', 'Estado', ''].map(h => (
                                <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {users.map((user, i) => (
                            <tr
                                key={user.id}
                                className={cn(
                                    'group border-b border-border/50 transition-colors hover:bg-accent/20',
                                    !user.active && 'opacity-50',
                                    i % 2 === 0 ? 'bg-background/40' : 'bg-background/20',
                                )}
                            >
                                {/* User */}
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                                            {user.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium">{user.name}</p>
                                            <p className="text-xs text-muted-foreground">{user.email}</p>
                                        </div>
                                    </div>
                                </td>
                                {/* Role */}
                                <td className="px-4 py-3">
                                    <Badge className={cn('border text-xs', ROLE_COLORS[user.role as UserRole])}>
                                        <Shield className="mr-1 h-2.5 w-2.5" />
                                        {ROLE_LABELS[user.role as UserRole]}
                                    </Badge>
                                </td>
                                {/* Vault access */}
                                <td className="px-4 py-3">
                                    <span className="text-xs text-muted-foreground">
                                        {user.role === 'admin'     ? 'Todos los vaults'
                                        : user.role === 'technical' ? 'Vaults técnicos'
                                        : user.role === 'business'  ? 'Vault empresa'
                                        : 'Solo lectura'}
                                    </span>
                                </td>
                                {/* Last active */}
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <Clock className="h-3 w-3" />
                                        {user.lastActiveAt
                                            ? new Date(user.lastActiveAt).toLocaleDateString('es', { day: '2-digit', month: 'short' })
                                            : 'Nunca'}
                                    </div>
                                </td>
                                {/* Status */}
                                <td className="px-4 py-3">
                                    {user.active
                                        ? <div className="flex items-center gap-1.5 text-xs text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" />Activo</div>
                                        : <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><XCircle className="h-3.5 w-3.5" />Inactivo</div>
                                    }
                                </td>
                                {/* Actions */}
                                <td className="px-4 py-3">
                                    <DropdownMenu.Root>
                                        <DropdownMenu.Trigger asChild>
                                            <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100">
                                                <MoreHorizontal className="h-4 w-4" />
                                            </Button>
                                        </DropdownMenu.Trigger>
                                        <DropdownMenu.Portal>
                                            <DropdownMenu.Content align="end" className="z-50 min-w-[160px] rounded-lg border border-border bg-popover p-1 shadow-lg">
                                                {(['admin', 'technical', 'business', 'viewer'] as UserRole[]).map(role => (
                                                    <DropdownMenu.Item
                                                        key={role}
                                                        className={cn('flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-none hover:bg-accent', user.role === role && 'text-primary')}
                                                        onSelect={() => changeRole(user.id, role)}
                                                    >
                                                        {user.role === role && <CheckCircle2 className="h-3 w-3" />}
                                                        <span className={user.role !== role ? 'ml-4' : ''}>
                                                            Cambiar a {ROLE_LABELS[role]}
                                                        </span>
                                                    </DropdownMenu.Item>
                                                ))}
                                                <DropdownMenu.Separator className="my-1 h-px bg-border" />
                                                <DropdownMenu.Item
                                                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-none hover:bg-accent text-muted-foreground"
                                                    onSelect={() => toggleActive(user.id, user.active!)}
                                                >
                                                    {user.active ? <XCircle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                                                    {user.active ? 'Desactivar' : 'Activar'}
                                                </DropdownMenu.Item>
                                            </DropdownMenu.Content>
                                        </DropdownMenu.Portal>
                                    </DropdownMenu.Root>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Invite dialog */}
            <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <UserPlus className="h-4 w-4 text-primary" />
                            Nuevo usuario
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-2">
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Nombre completo</label>
                            <Input placeholder="Juan García" value={inviteName} onChange={e => setInviteName(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Email</label>
                            <Input type="email" placeholder="juan@empresa.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Contraseña inicial</label>
                            <Input type="password" placeholder="••••••••" value={invitePass} onChange={e => setInvitePass(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Rol</label>
                            <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as UserRole)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {(['admin', 'technical', 'business', 'viewer'] as UserRole[]).map(role => (
                                        <SelectItem key={role} value={role}>
                                            <div className="flex flex-col">
                                                <span>{ROLE_LABELS[role]}</span>
                                                <span className="text-xs text-muted-foreground">
                                                    {role === 'admin'     ? 'Acceso total + gestión de usuarios'
                                                    : role === 'technical' ? 'Vaults técnicos (AI, TS, arquitectura)'
                                                    : role === 'business'  ? 'Vault de empresa (procesos, normas)'
                                                    : 'Solo lectura en todos los vaults'}
                                                </span>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancelar</Button>
                            <Button
                                onClick={createUser}
                                disabled={!inviteName || !inviteEmail || !invitePass || saving}
                                className="gap-2"
                            >
                                {saving ? 'Creando...' : 'Crear usuario'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
