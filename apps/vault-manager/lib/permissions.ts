import type { UserRole } from '@/db/schema';

export type VaultOwnerRole = 'admin' | 'technical' | 'business';

export function canAccessVault(userRole: UserRole, vaultOwnerRole: VaultOwnerRole): boolean {
    if (userRole === 'admin') return true;
    return vaultOwnerRole === userRole;
}

export function canIngest(userRole: UserRole):  boolean { return userRole !== 'viewer'; }
export function canAudit(userRole: UserRole):   boolean { return userRole !== 'viewer'; }
export function canImprove(userRole: UserRole): boolean { return userRole !== 'viewer'; }
export function canManageUsers(userRole: UserRole): boolean { return userRole === 'admin'; }

export const ROLE_LABELS: Record<UserRole, string> = {
    admin:     'Administrador',
    technical: 'Técnico',
    business:  'Negocio',
    viewer:    'Visor',
};

export const ROLE_COLORS: Record<UserRole, string> = {
    admin:     'text-rose-400 bg-rose-950/50 border-rose-800',
    technical: 'text-blue-400 bg-blue-950/50 border-blue-800',
    business:  'text-purple-400 bg-purple-950/50 border-purple-800',
    viewer:    'text-zinc-400 bg-zinc-800/50 border-zinc-700',
};

export const AUDIT_STATUS_COLORS: Record<string, string> = {
    pending:    'text-amber-400 bg-amber-950/50 border-amber-800',
    approved:   'text-emerald-400 bg-emerald-950/50 border-emerald-800',
    rejected:   'text-red-400 bg-red-950/50 border-red-800',
    improved:   'text-indigo-400 bg-indigo-950/50 border-indigo-800',
    processing: 'text-blue-400 bg-blue-950/50 border-blue-800',
};

export const AUDIT_STATUS_LABELS: Record<string, string> = {
    pending:    'Pendiente',
    approved:   'Aprobado',
    rejected:   'Rechazado',
    improved:   'Mejorado',
    processing: 'Procesando',
};

export const INGEST_STATUS_COLORS: Record<string, string> = {
    queued:     'text-zinc-400 bg-zinc-800/50 border-zinc-700',
    processing: 'text-blue-400 bg-blue-950/50 border-blue-800',
    done:       'text-emerald-400 bg-emerald-950/50 border-emerald-800',
    failed:     'text-red-400 bg-red-950/50 border-red-800',
};
