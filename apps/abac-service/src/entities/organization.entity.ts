import { Entity, Column, Index, Unique, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';

export enum OrganizationStatus {
    ACTIVE = 'active',
    SUSPENDED = 'suspended',
    PENDING = 'pending',
}

/**
 * Tenant del modelo SaaS B2B. Cada compañía es una Organization self-service.
 * La **System org** (`isSystem=true`, UUID fijo) es dueña de la infraestructura de
 * plataforma (apps M2M, super-admins). Ver `.specs/adr-multitenancy.md`.
 */
@Entity('organizations')
@Unique(['slug'])
@Index(['status', 'isActive'])
export class Organization extends BaseEntity {
    @Column({ type: 'varchar', length: 150 })
    name!: string;

    /** Identificador estable y legible; viaja en el claim `orgSlug`. */
    @Column({ type: 'varchar', length: 100 })
    slug!: string;

    @Column({ type: 'enum', enum: OrganizationStatus, default: OrganizationStatus.ACTIVE })
    status!: OrganizationStatus;

    @Column({ type: 'varchar', length: 20, default: 'free' })
    plan!: string;

    /** true solo para la System org (infraestructura de plataforma). */
    @Column({ type: 'boolean', default: false })
    isSystem!: boolean;

    @Column({ type: 'json', nullable: true })
    settings!: Record<string, any> | null;

    @OneToMany(() => User, (u) => u.organization)
    users!: User[];
}
