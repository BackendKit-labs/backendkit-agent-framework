import { resolveTenantContext } from './tenant-context';
import { TenantScope } from './tenant-scope';
import { SYSTEM_ORG_ID } from './tenancy.constants';

const ORG_A = 'org-aaaa';

describe('resolveTenantContext', () => {
    it('usuario JWT con org → contexto del tenant (no plataforma)', () => {
        const ctx = resolveTenantContext({ user: { org: ORG_A, orgSlug: 'acme', accountType: 'user' } });
        expect(ctx).toEqual({ organizationId: ORG_A, orgSlug: 'acme', isPlatform: false });
    });

    it('usuario de la System org → isPlatform', () => {
        const ctx = resolveTenantContext({ user: { org: SYSTEM_ORG_ID, accountType: 'user' } });
        expect(ctx.isPlatform).toBe(true);
    });

    it('cuenta de servicio → isPlatform aunque la org no sea System', () => {
        const ctx = resolveTenantContext({ user: { org: ORG_A, accountType: 'service' } });
        expect(ctx.isPlatform).toBe(true);
    });

    it('principal api-key (req.application) → org de la app', () => {
        const ctx = resolveTenantContext({ application: { organizationId: ORG_A } });
        expect(ctx).toEqual({ organizationId: ORG_A, orgSlug: null, isPlatform: false });
    });

    it('sin principal (ruta pública) → contexto vacío', () => {
        expect(resolveTenantContext({})).toEqual({
            organizationId: null, orgSlug: null, isPlatform: false,
        });
    });
});

describe('TenantScope', () => {
    const tenant = { organizationId: ORG_A, orgSlug: 'acme', isPlatform: false };
    const platform = { organizationId: SYSTEM_ORG_ID, orgSlug: 'system', isPlatform: true };

    it('where(): tenant filtra por org; plataforma no filtra', () => {
        expect(TenantScope.where(tenant)).toEqual({ organizationId: ORG_A });
        expect(TenantScope.where(platform)).toEqual({});
    });

    it('owns(): tenant solo posee su org; plataforma posee todo', () => {
        expect(TenantScope.owns(tenant, ORG_A)).toBe(true);
        expect(TenantScope.owns(tenant, 'org-otra')).toBe(false);
        expect(TenantScope.owns(platform, 'org-cualquiera')).toBe(true);
    });

    it('apply(): agrega andWhere para tenant; lo omite para plataforma', () => {
        const qb: any = { andWhere: jest.fn().mockReturnThis() };
        TenantScope.apply(qb, 'u', tenant);
        expect(qb.andWhere).toHaveBeenCalledWith('u.organizationId = :__tenantOrg', { __tenantOrg: ORG_A });

        const qb2: any = { andWhere: jest.fn().mockReturnThis() };
        TenantScope.apply(qb2, 'u', platform);
        expect(qb2.andWhere).not.toHaveBeenCalled();
    });

    it('cacheKey(): namespaced por org', () => {
        expect(TenantScope.cacheKey(tenant, 'perms', 'user-1')).toBe(`abac:${ORG_A}:perms:user-1`);
        expect(TenantScope.cacheKey(platform, 'perms')).toBe(`abac:${SYSTEM_ORG_ID}:perms`);
    });
});
