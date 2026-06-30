import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentCatalog } from './agent-catalog';
import { CatalogEntry } from './entities/catalog-entry.entity';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([CatalogEntry]), AuthModule],
  controllers: [CatalogController],
  providers: [AgentCatalog, CatalogService],
  exports: [AgentCatalog, CatalogService],
})
export class CatalogModule {}
