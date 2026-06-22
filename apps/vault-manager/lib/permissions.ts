// Roles del auth-service (enterprise.db) — source of truth
export type UserRole = 'admin' | 'development' | 'devops' | 'hr' | 'sales' | 'finance' | 'viewer';

// Categorías de acceso al vault (ownerRole en vault_definitions)
export type VaultOwnerRole = 'admin' | 'technical' | 'business';

/**
 * Mapea un rol del auth-service a una categoría de vault:
 *   admin                    → admin
 *   development, devops      → technical
 *   hr, sales, finance       → business
 *   viewer                   → viewer (solo vaults sin ownerRole restriction)
 */
export function toVaultCategory(role: UserRole): 'admin' | 'technical' | 'business' | 'viewer' {
    if (role === 'admin')                                    return 'admin';
    if (role === 'development' || role === 'devops')         return 'technical';
    if (role === 'hr' || role === 'sales' || role === 'finance') return 'business';
    return 'viewer';
}

export function canAccessVault(userRole: UserRole, vaultOwnerRole: VaultOwnerRole): boolean {
    if (userRole === 'admin') return true;
    const category = toVaultCategory(userRole);
    return category === vaultOwnerRole;
}

export function canIngest(userRole: UserRole):       boolean { return userRole !== 'viewer'; }
export function canAudit(userRole: UserRole):        boolean { return userRole !== 'viewer'; }
export function canImprove(userRole: UserRole):      boolean { return userRole !== 'viewer'; }
export function canManageVaults(userRole: UserRole): boolean { return userRole === 'admin'; }

/** Backward compat alias — las rutas API lo usan para verificar acceso admin */
export const canManageUsers = canManageVaults;

export const ROLE_LABELS: Record<UserRole, string> = {
    admin:       'Administrador',
    development: 'Desarrollo',
    devops:      'DevOps',
    hr:          'RR.HH.',
    sales:       'Ventas',
    finance:     'Finanzas',
    viewer:      'Visor',
};

export const ROLE_COLORS: Record<UserRole, string> = {
    admin:       'text-rose-400 bg-rose-950/50 border-rose-800',
    development: 'text-blue-400 bg-blue-950/50 border-blue-800',
    devops:      'text-sky-400 bg-sky-950/50 border-sky-800',
    hr:          'text-purple-400 bg-purple-950/50 border-purple-800',
    sales:       'text-emerald-400 bg-emerald-950/50 border-emerald-800',
    finance:     'text-amber-400 bg-amber-950/50 border-amber-800',
    viewer:      'text-zinc-400 bg-zinc-800/50 border-zinc-700',
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
