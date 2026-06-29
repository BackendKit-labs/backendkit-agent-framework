import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_TOOL_KEY } from '../../common/decorators/require-tool.decorator';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { AbacClientService } from '../../abac/abac-client.service';

/**
 * Autoriza un endpoint contra permisos ABAC o tools legacy.
 *
 * Debe ejecutarse DESPUÉS de `FlexAuthGuard`. Dos modos:
 *
 *  @RequirePermission('resource:action') — NUEVO. Llama al PDP de abac-service cuando
 *    el token proviene de abac-service (tiene claim `org`). Para tokens de auth-service
 *    hace fallback a tools[].
 *
 *  @RequireTool('tool_name') — LEGACY. Mantiene el check directo sobre tools[].
 *
 * M2M ApiKey: scopes null/vacío/'*' = todas las scopes permitidas (sin PDP).
 * Ver `.specs/adr-unified-auth.md` (sub-fases 4b y 4d).
 */
@Injectable()
export class AuthzGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly abacClient: AbacClientService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<string>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredTools = this.reflector.getAllAndOverride<string[]>(
      REQUIRE_TOOL_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!permission && (!requiredTools || requiredTools.length === 0)) return true;

    const req = context.switchToHttp().getRequest();

    // M2M ApiKey: scopes null/vacío o '*' = todas las scopes
    const apiKey = req.apiKey;
    if (apiKey) {
      const scopes: string[] | null = apiKey.scopes;
      if (!scopes || scopes.length === 0 || scopes.includes('*')) return true;
      const required = requiredTools ?? (permission ? [permission] : []);
      if (required.some((t) => scopes.includes(t))) return true;
      throw new ForbiddenException(
        `API key sin scope requerida: ${required.join(' | ')}`,
      );
    }

    const user = req.user;
    if (!user) throw new ForbiddenException('Sin contexto de autenticación');

    // abac-service token (claim `org` presente) + @RequirePermission → llama al PDP
    if (permission && user.org !== undefined) {
      const [resource, action] = permission.split(':');
      const allowed = await this.abacClient.canAccess(
        user.id,
        resource,
        action,
        { organizationId: user.org },
      );
      if (allowed) return true;
      throw new ForbiddenException(`Permiso denegado: ${permission}`);
    }

    // Fallback: check directo de tools[] (tokens de auth-service o @RequireTool)
    const tools: string[] = user.tools ?? [];
    const toolsToCheck = requiredTools ?? (permission ? [permission] : []);
    if (toolsToCheck.some((t) => tools.includes(t))) return true;
    throw new ForbiddenException(
      `Permiso insuficiente: ${permission ?? requiredTools?.join(' | ')}`,
    );
  }
}
