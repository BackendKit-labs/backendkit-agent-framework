export interface Principal {
    id:          string;
    role:        string;
    department?: string;
}

/** Principal implícito cuando no hay token (REPL / dev mode). */
export const ADMIN_PRINCIPAL: Principal = {
    id:   'system',
    role: 'admin',
};
