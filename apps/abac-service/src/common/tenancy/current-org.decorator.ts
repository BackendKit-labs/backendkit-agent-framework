import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TenantContext, resolveTenantContext } from './tenant-context';

/**
 * Inyecta el TenantContext del principal en un handler.
 * Ej: `findAll(@CurrentOrg() org: TenantContext) { ... }`.
 * Lee `req.tenant` (lo pone TenantContextInterceptor); si no está, lo resuelve.
 */
export const CurrentOrg = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): TenantContext => {
        const req = ctx.switchToHttp().getRequest();
        return req.tenant ?? resolveTenantContext(req);
    },
);
