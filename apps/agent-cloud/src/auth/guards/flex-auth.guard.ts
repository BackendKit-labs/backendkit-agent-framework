import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ApiKeyAuthGuard } from '../../api-keys/guards/api-key-auth.guard';

/**
 * Accepts either a JWT Bearer token OR an X-Api-Key header.
 * JWT is tried first (covers human users); ApiKey is the fallback (covers
 * machine-to-machine clients like the director-agent).
 */
@Injectable()
export class FlexAuthGuard implements CanActivate {
  constructor(
    private readonly jwtGuard: JwtAuthGuard,
    private readonly apiKeyGuard: ApiKeyAuthGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const result = await this.jwtGuard.canActivate(context);
      if (result) return true;
    } catch {
      // JWT absent or invalid — fall through to ApiKey
    }
    return this.apiKeyGuard.canActivate(context);
  }
}
