import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION_KEY = 'require_permission';

/**
 * Declara el permiso ABAC necesario para acceder al endpoint.
 * Formato: 'resource:action'  (ej. 'deployable:deploy', 'deployable:list').
 *
 * Si el token es de abac-service (tiene claim `org`) → el AuthzGuard llama al PDP.
 * Si el token es de auth-service (solo tools[]) → verifica contra tools[] como fallback.
 */
export const RequirePermission = (permission: string) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permission);
