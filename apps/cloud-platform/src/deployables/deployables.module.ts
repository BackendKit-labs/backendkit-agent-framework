import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployablesController } from './deployables.controller';
import { DeployablesService } from './deployables.service';
import { Deployable } from './entities/deployable.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Deployable]), AuthModule],
  controllers: [DeployablesController],
  providers: [DeployablesService],
  exports: [DeployablesService],
})
export class DeployablesModule {}
