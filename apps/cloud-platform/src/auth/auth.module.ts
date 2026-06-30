import { Module, forwardRef } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { EdDsaJwtStrategy } from './strategies/eddsa-jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { EdDsaAuthGuard } from './guards/eddsa-auth.guard';
import { FlexAuthGuard } from './guards/flex-auth.guard';
import { AuthzGuard } from './guards/authz.guard';
import { ApiKeysModule } from '../api-keys/api-keys.module';

/**
 * cloud-platform NO emite identidad: abac-service es el único IdP.
 * Valida tokens EdDSA de abac-service de forma stateless.
 */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'eddsa-jwt' }),
    forwardRef(() => ApiKeysModule),
  ],
  providers: [
    EdDsaJwtStrategy,
    { provide: 'JWT_AUTH_GUARD', useClass: JwtAuthGuard },
    JwtAuthGuard,
    EdDsaAuthGuard,
    FlexAuthGuard,
    AuthzGuard,
  ],
  exports: [
    PassportModule,
    JwtAuthGuard,
    EdDsaAuthGuard,
    FlexAuthGuard,
    AuthzGuard,
    forwardRef(() => ApiKeysModule),
  ],
})
export class AuthModule {}
