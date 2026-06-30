import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { AbacClientService } from '../../abac/abac-client.service';

/**
 * Autoriza un endpoint contra el PDP de abac-service.
 *
 * Debe ejecutarse DESPUÉS de FlexAuthGuard. Tres caminos:
 *  - Sin @RequirePermission               → allow sin consultar PDP
 *  - ApiKey: scopes null/vacío/'*'        → allow; scopes con valores → debe incluir el permiso
 *  - Bearer EdDSA (req.user)              → llama al PDP con organizationId del token
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

    if (!permission) return true;

    const req = context.switchToHttp().getRequest();

    const apiKey = req.apiKey;
    if (apiKey) {
      const scopes: string[] | null = apiKey.scopes;
      if (!scopes || scopes.length === 0 || scopes.includes('*')) return true;
      if (scopes.includes(permission)) return true;
      throw new ForbiddenException(`API key sin scope requerida: ${permission}`);
    }

    const user = req.user;
    if (!user) throw new ForbiddenException('Sin contexto de autenticación');

    const [resource, action] = permission.split(':');
    const allowed = await this.abacClient.canAccess(
      user.id,
      resource,
      action,
      { organizationId: user.org ?? null },
    );
    if (allowed) return true;
    throw new ForbiddenException(`Permiso denegado: ${permission}`);
  }
}
