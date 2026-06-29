import { SYSTEM_ORG_ID } from './tenancy.constants';

/**
 * Contexto de tenant resuelto desde el principal autenticado de la request.
 * Ver `.specs/adr-multitenancy.md` (T2).
 */
export interface TenantContext {
    /** Org del principal. null cuando no hay principal (ruta pública). */
    organizationId: string | null;
    orgSlug: string | null;
    /**
     * true = principal de plataforma (System org o cuenta de servicio).
     * Bypassa el scoping por tenant — puede ver/operar cualquier org.
     */
    isPlatform: boolean;
}

/**
 * Resuelve el TenantContext desde `req.user` (JWT) o `req.application` (api-key/M2M).
 * Stateless: solo lee lo que los guards/strategies ya pusieron en la request.
 */
export function resolveTenantContext(req: any): TenantContext {
    const user = req?.user;
    if (user && user.org !== undefined) {
        const organizationId = user.org ?? null;
        return {
            organizationId,
            orgSlug: user.orgSlug ?? null,
            isPlatform: organizationId === SYSTEM_ORG_ID || user.accountType === 'service',
        };
    }

    const app = req?.application;
    if (app && app.organizationId !== undefined) {
        const organizationId = app.organizationId ?? null;
        return {
            organizationId,
            orgSlug: null,
            isPlatform: organizationId === SYSTEM_ORG_ID,
        };
    }

    return { organizationId: null, orgSlug: null, isPlatform: false };
}
