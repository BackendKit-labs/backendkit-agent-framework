export interface Principal {
    id:          string;
    /** Rol primario derivado de roles[0] — mantenido para compatibilidad con vault-filter y policy. */
    role:        string;
    email?:      string;
    org?:        string | null;
    orgSlug?:    string | null;
    roles:       string[];
    permissions: string[];
    department?: string;
    /** Workspace custom (auth-service legacy) — siempre undefined con abac-service. */
    tools?: string[];
    /**
     * Override personal de prefijos de vault (claim vaultResources de abac).
     * undefined = sin override → VaultFilter usa vault_visibility por rol.
     */
    vault?: string[];
    /** Workspace custom (auth-service legacy) — siempre undefined con abac-service. */
    apps?:  string[];
}

/** Principal implícito cuando no hay token (REPL / dev mode). */
export const ADMIN_PRINCIPAL: Principal = {
    id:          'system',
    role:        'admin',
    roles:       ['admin'],
    permissions: ['*'],
};
