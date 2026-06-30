import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { EdDsaAuthGuard } from './eddsa-auth.guard';
import { ApiKeyAuthGuard } from '../../api-keys/guards/api-key-auth.guard';

/**
 * Acepta dos formas de autenticación en orden de prioridad:
 *  1. Bearer EdDSA — token firmado por abac-service (IdP central)
 *  2. X-Api-Key    — M2M local (ApiKey registrada en cloud-platform)
 */
@Injectable()
export class FlexAuthGuard implements CanActivate {
  constructor(
    private readonly edDsaGuard: EdDsaAuthGuard,
    private readonly apiKeyGuard: ApiKeyAuthGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      if (await this.edDsaGuard.canActivate(context)) return true;
    } catch { /* token EdDSA ausente o inválido — intenta ApiKey */ }

    return this.apiKeyGuard.canActivate(context);
  }
}
