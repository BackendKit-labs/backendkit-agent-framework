import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { appConfig } from './config/app.config';
import databaseConfig from './config/database.config';
import { CorrelationMiddleware, ObservabilityModule } from './observability';
import { AuthModule } from './auth/auth.module';
import { AuditModule, PolicyModule, OrganizationsModule } from './modules';

import { AbacModule } from './abac/abac.module';
import { ResourcesModule } from './resources/resources.module';
import { HealthController } from './health.controller';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditInterceptor } from './abac/interceptors/audit.interceptor';
import { TenantContextInterceptor } from './common/tenancy';
import { BootstrapService } from './bootstrap.service';
import { TypeOrmModule as TypeOrmFeature } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { Application } from './entities/application.entity';
import { UserRole } from './entities/user-role.entity';
import { Organization } from './entities/organization.entity';

/**
 * @description
 * Root module for the application
 * @returns {Module} AppModule
 * @version 1.0.0
 * @author Mairon Cuello
 * @license MIT
 * @copyright 2025 Mairon Cuello
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        ...config.get('database')!,
        retryAttempts: 3,
        retryDelay: 2000,
      }),
      inject: [ConfigService],
    }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get('jwtSecret'),
        signOptions: { expiresIn: config.get('jwtExpiresIn') },
      }),
      inject: [ConfigService],
    }),
    PassportModule,
    AbacModule,
    AuthModule,
    PolicyModule,
    AuditModule,
    OrganizationsModule,
    ResourcesModule,
    ObservabilityModule.forRoot({ serviceName: 'abac-service' }),
    TypeOrmFeature.forFeature([User, Role, Application, UserRole, Organization]),
  ],
  controllers: [HealthController],
  providers: [
    BootstrapService,
    // Normaliza req.tenant antes que el resto de interceptors lo necesiten.
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantContextInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).exclude('/health', '/api-docs', '/metrics').forRoutes('*')
  }
}
