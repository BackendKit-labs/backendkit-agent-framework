import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organization } from '../entities/organization.entity';

/**
 * Registra la entidad Organization para que `autoLoadEntities` la cargue y
 * TypeORM resuelva el metadata de las relaciones `*.organization` (User, Role,
 * Policy, Application, AuditLog).
 *
 * T1: solo el repositorio. El OrganizationsService/Controller (CRUD + tenant
 * signup self-service) llega en T3. Ver `.specs/adr-multitenancy.md`.
 */
@Module({
    imports: [TypeOrmModule.forFeature([Organization])],
    exports: [TypeOrmModule],
})
export class OrganizationsModule {}
