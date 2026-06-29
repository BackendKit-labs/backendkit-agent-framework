import { Module, forwardRef } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './strategies/jwt.strategy';
import { EdDsaJwtStrategy } from './strategies/eddsa-jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { EdDsaAuthGuard } from './guards/eddsa-auth.guard';
import { FlexAuthGuard } from './guards/flex-auth.guard';
import { AuthzGuard } from './guards/authz.guard';
import { ApiKeysModule } from '../api-keys/api-keys.module';

/**
 * cloud-platform NO emite identidad: abac-service (y transitoriamente auth-service)
 * son los únicos IdPs. Este módulo provee la validación stateless de sus JWT y los
 * guards de autenticación/autorización. Ver `.specs/adr-unified-auth.md`.
 */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    forwardRef(() => ApiKeysModule),
  ],
  providers: [
    JwtStrategy,
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
