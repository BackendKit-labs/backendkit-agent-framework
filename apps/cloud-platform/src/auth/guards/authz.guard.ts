import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_TOOL_KEY } from '../../common/decorators/require-tool.decorator';

/**
 * Autoriza un endpoint contra el vocabulario de tools cloud.
 *
 * Debe ejecutarse DESPUÉS de `FlexAuthGuard` (que puebla `req.user` para JWT o
 * `req.apiKey` para M2M). Dos caminos:
 *  - Humano (JWT de auth-service): autoriza si `req.user.tools` incluye la tool requerida.
 *  - M2M (ApiKey): autoriza si `scopes` incluye la tool, o es comodín (`*`, null o vacío).
 *
 * Sin `@RequireTool` en el endpoint → no exige nada (solo autenticación).
 * Ver `.specs/adr-unified-auth.md` (sub-fase 4b).
 */
@Injectable()
export class AuthzGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRE_TOOL_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();

    // M2M: ApiKey. scopes null/vacío o '*' = todas las scopes permitidas.
    const apiKey = req.apiKey;
    if (apiKey) {
      const scopes: string[] | null = apiKey.scopes;
      if (!scopes || scopes.length === 0 || scopes.includes('*')) return true;
      if (required.some((t) => scopes.includes(t))) return true;
      throw new ForbiddenException(
        `API key missing required scope: ${required.join(' | ')}`,
      );
    }

    // Humano: JWT con tools[] emitido por auth-service.
    const user = req.user;
    if (user) {
      const tools: string[] = user.tools ?? [];
      if (required.some((t) => tools.includes(t))) return true;
      throw new ForbiddenException(
        `Missing required tool: ${required.join(' | ')}`,
      );
    }

    throw new ForbiddenException('No authentication context');
  }
}
