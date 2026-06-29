import { SelectQueryBuilder } from 'typeorm';
import { TenantContext } from './tenant-context';

/**
 * Helpers de aislamiento por tenant. Regla dura: ninguna query tenant-scoped sin
 * pasar por aquí. Los principales de plataforma (System org / servicios) bypassan
 * el filtro. Ver `.specs/adr-multitenancy.md` (T2).
 */
export class TenantScope {
    /** Aplica `WHERE alias.organizationId = :org` a un QueryBuilder (salvo plataforma). */
    static apply<T extends import('typeorm').ObjectLiteral>(
        qb: SelectQueryBuilder<T>,
        alias: string,
        ctx: TenantContext,
    ): SelectQueryBuilder<T> {
        if (ctx.isPlatform) return qb;
        return qb.andWhere(`${alias}.organizationId = :__tenantOrg`, {
            __tenantOrg: ctx.organizationId,
        });
    }

    /** where-object para `repo.find()/findOne()` (plataforma → sin filtro). */
    static where(ctx: TenantContext): Record<string, unknown> {
        return ctx.isPlatform ? {} : { organizationId: ctx.organizationId };
    }

    /**
     * ¿El principal puede ver/operar un recurso de esta org? El caller decide el
     * efecto (404 para no filtrar existencia entre tenants).
     */
    static owns(ctx: TenantContext, resourceOrgId: string | null | undefined): boolean {
        return ctx.isPlatform || resourceOrgId === ctx.organizationId;
    }

    /** Clave de cache namespaced por org: `abac:<org>:<parts...>`. */
    static cacheKey(ctx: TenantContext, ...parts: string[]): string {
        return ['abac', ctx.organizationId ?? 'global', ...parts].join(':');
    }
}
