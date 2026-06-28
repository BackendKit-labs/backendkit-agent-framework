import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DirectorController } from './director.controller';
import { DirectorService } from './director.service';
import { Deployable } from '../deployables/entities/deployable.entity';
import { AuthModule } from '../auth/auth.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { RuntimeReconciler } from '../runtime/runtime.reconciler';
import { CatalogModule } from '../catalog/catalog.module';
import { DepartmentsModule } from '../departments/departments.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Deployable]),
    AuthModule,
    RuntimeModule,
    CatalogModule,
    DepartmentsModule,   // exports SecretsService
  ],
  controllers: [DirectorController],
  providers: [DirectorService, RuntimeReconciler],
  exports: [DirectorService],
})
export class DirectorModule {}
