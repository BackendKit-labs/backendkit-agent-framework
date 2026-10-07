import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { EdDsaJwtStrategy } from './strategies/eddsa-jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { FlexAuthGuard } from './guards/flex-auth.guard';
import { ApiKeysModule } from '../api-keys/api-keys.module';

/**
 * director-agent NO emite identidad: abac-service es el único IdP.
 * Este módulo valida tokens EdDSA de abac-service de forma stateless.
 */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'eddsa-jwt' }),
    ApiKeysModule,
  ],
  providers: [
    EdDsaJwtStrategy,
    JwtAuthGuard,
    FlexAuthGuard,
  ],
  exports: [
    PassportModule,
    JwtAuthGuard,
    FlexAuthGuard,
    ApiKeysModule,
  ],
})
export class AuthModule {}
