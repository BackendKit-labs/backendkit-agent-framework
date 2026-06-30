import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AbacModule } from './abac/abac.module';
import { AuthModule } from './auth/auth.module';
import { DirectorModule } from './director/director.module';
import { DepartmentsModule } from './departments/departments.module';
import { DeployablesModule } from './deployables/deployables.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { WorkflowsModule } from './workflows/workflows.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AbacModule,
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USER || process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || process.env.DB_DATABASE || 'cloud_platform',
      autoLoadEntities: true,
      synchronize: process.env.NODE_ENV !== 'production',
    }),
    AuthModule,
    DirectorModule,
    DepartmentsModule,
    DeployablesModule,
    ApiKeysModule,
    WorkflowsModule,
  ],
})
export class AppModule {}