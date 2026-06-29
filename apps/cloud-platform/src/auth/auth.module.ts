import { Module, forwardRef } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { FlexAuthGuard } from './guards/flex-auth.guard';
import { ApiKeysModule } from '../api-keys/api-keys.module';

/**
 * cloud-platform NO emite identidad: auth-service es el único IdP. Este módulo solo
 * provee la validación stateless de los JWT de auth-service (JwtStrategy) y los guards
 * de autenticación/autorización. Ver `.specs/adr-unified-auth.md`.
 */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    forwardRef(() => ApiKeysModule),
  ],
  providers: [
    JwtStrategy,
    {
      provide: 'JWT_AUTH_GUARD',
      useClass: JwtAuthGuard,
    },
    JwtAuthGuard,
    FlexAuthGuard,
  ],
  exports: [
    PassportModule,
    JwtAuthGuard,
    FlexAuthGuard,
    forwardRef(() => ApiKeysModule),
  ],
})
export class AuthModule {}
