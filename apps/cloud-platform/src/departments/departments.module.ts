import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';
import { SecretsService } from './secrets.service';
import { Department } from './entities/department.entity';
import { Secret } from './entities/secret.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Department, Secret]), AuthModule],
  controllers: [DepartmentsController],
  providers: [DepartmentsService, SecretsService],
  exports: [DepartmentsService, SecretsService],
})
export class DepartmentsModule {}
