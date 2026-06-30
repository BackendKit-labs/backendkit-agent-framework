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
    vault?: string[];
    apps?:  string[];
}

/** Principal implícito cuando no hay token (REPL / dev mode). */
export const ADMIN_PRINCIPAL: Principal = {
    id:          'system',
    role:        'admin',
    roles:       ['admin'],
    permissions: ['*'],
};
