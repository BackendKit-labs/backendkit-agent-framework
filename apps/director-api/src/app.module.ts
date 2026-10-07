import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ObservabilityModule } from '@backendkit-labs/observability';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AgentsModule } from './agents/agents.module';
import { ProjectsModule } from './projects/projects.module';
import { DirectorModule } from './director/director.module';
import { DepartmentsModule } from './departments/departments.module';
import { DeployablesModule } from './deployables/deployables.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ObservabilityModule.forRoot({
      serviceName: 'director-api',
      logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') ?? 'info',
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_DATABASE || 'agent_cloud',
      autoLoadEntities: true,
      synchronize: process.env.NODE_ENV !== 'production',
    }),
    AuthModule,
    UsersModule,
    AgentsModule,
    ProjectsModule,
    DirectorModule,
    DepartmentsModule,
    DeployablesModule,
    ApiKeysModule,
    WorkflowsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}