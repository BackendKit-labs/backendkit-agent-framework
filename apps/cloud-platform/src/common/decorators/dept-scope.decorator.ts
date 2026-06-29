import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Resuelve el alcance por departamento de la request, como **slug** de departamento
 * (opción (a) del ADR — `apps/auth-service` emite `dept` como nombre/slug, no como UUID).
 *
 *  - M2M (ApiKey, ej. el director): `null` → sin restricción (ve/opera todo).
 *  - JWT humano con claim `dept`: el slug → restringe a ese departamento.
 *  - JWT humano sin `dept` (roles globales tipo admin/devops): `null` → sin restricción.
 *
 * `null` significa "sin scope". Los servicios filtran por `Department.slug` cuando recibe
 * un slug. Ver `.specs/adr-unified-auth.md` (sub-fase 4b).
 */
export const DeptScope = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const req = ctx.switchToHttp().getRequest();
    if (req.apiKey) return null;
    return req.user?.dept ?? null;
  },
);
