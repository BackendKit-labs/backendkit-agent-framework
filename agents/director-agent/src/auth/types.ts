export interface Principal {
    id:          string;
    role:        string;
    department?: string;
    /** Workspace custom del auth-service. undefined = usar defaults del rol en director.yaml */
    tools?: string[];
    /** Namespaces del vault custom. undefined = usar vault_visibility del rol en director.yaml */
    vault?: string[];
    /** Apps a las que tiene acceso (director, vault-manager) */
    apps?:  string[];
}

/** Principal implícito cuando no hay token (REPL / dev mode). */
export const ADMIN_PRINCIPAL: Principal = {
    id:   'system',
    role: 'admin',
};
