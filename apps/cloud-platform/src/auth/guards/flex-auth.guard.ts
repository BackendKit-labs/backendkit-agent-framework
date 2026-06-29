import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { EdDsaAuthGuard } from './eddsa-auth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ApiKeyAuthGuard } from '../../api-keys/guards/api-key-auth.guard';

/**
 * Acepta tres formas de autenticación en orden de prioridad:
 *  1. Bearer EdDSA — token firmado por abac-service (IdP central)
 *  2. Bearer HS256 — token firmado por auth-service (transitional)
 *  3. X-Api-Key    — M2M local (ApiKey registrada en cloud-platform)
 */
@Injectable()
export class FlexAuthGuard implements CanActivate {
  constructor(
    private readonly edDsaGuard: EdDsaAuthGuard,
    private readonly jwtGuard: JwtAuthGuard,
    private readonly apiKeyGuard: ApiKeyAuthGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      if (await this.edDsaGuard.canActivate(context)) return true;
    } catch { /* abac-service token ausente o inválido — intenta siguiente */ }

    try {
      if (await this.jwtGuard.canActivate(context)) return true;
    } catch { /* auth-service token ausente o inválido — intenta siguiente */ }

    return this.apiKeyGuard.canActivate(context);
  }
}
