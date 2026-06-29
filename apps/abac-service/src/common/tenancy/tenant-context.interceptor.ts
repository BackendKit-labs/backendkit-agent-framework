import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { resolveTenantContext } from './tenant-context';

/**
 * Normaliza `req.tenant` desde el principal autenticado, para que servicios y el
 * decorador `@CurrentOrg()` lean un contexto consistente. Aditivo: en rutas
 * públicas deja `{ organizationId: null, isPlatform: false }`.
 * Ver `.specs/adr-multitenancy.md` (T2).
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const req = context.switchToHttp().getRequest();
        if (req) req.tenant = resolveTenantContext(req);
        return next.handle();
    }
}
