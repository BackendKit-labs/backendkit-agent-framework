import { Entity, Column, Index, OneToMany, ManyToOne, JoinColumn, BeforeInsert, BeforeUpdate, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import * as bcrypt from 'bcryptjs';
import { UserApplication } from './user-application.entity';
import { UserRole } from './user-role.entity';
import { Organization } from './organization.entity';


@Entity('users')
@Unique(['email'])
@Index(['isActive', 'createdAt'])
export class User extends BaseEntity {
    @Column({ type: 'varchar', length: 150 })
    email!: string;

    @Column({ type: 'varchar', length: 150 })
    firstName!: string;

    @Column({ type: 'varchar', length: 150 })
    lastName!: string;

    @Column({ type: 'varchar', length: 100, nullable: false })
    username!: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    completeName?: string;

    @Column({ type: 'varchar', length: 100, nullable: true })
    passwordHash!: string | null;

    @Column({ type: 'varchar', length: 20, nullable: true })
    status!: string;

    @Column({ type: 'varchar', length: 20, nullable: true })
    phone?: string;

    @Column({ type: 'json', nullable: true })
    profile!: Record<string, any>;

    @Column({ type: 'timestamp', nullable: true })
    lastLoginAt!: Date;

    @OneToMany(() => UserRole, (ur) => ur.user)
    roles!: UserRole[];

    // tenantId: atributo legacy ligado al tenant de Azure AD (no es la org del SaaS).
    @Column({ type: 'varchar', length: 100, nullable: true })
    tenantId!: string;

    // ── Multi-tenancy (org del SaaS) ────────────────────────────────────────────
    // Nullable en T1; se hace NOT NULL tras T2. Ver .specs/adr-multitenancy.md.
    @Column({ type: 'uuid', nullable: true })
    organizationId!: string | null;

    @ManyToOne(() => Organization, (org) => org.users, { nullable: true, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'organizationId' })
    organization!: Organization | null;

    @Column({ type: 'boolean', default: false })
    mfaEnabled!: boolean;

    @Column({ type: 'enum', enum: ['user', 'service'], default: 'user' })
    accountType!: 'user' | 'service';

    @Column({ type: 'varchar', length: 100, nullable: true, unique: true })
    entraId?: string | null;  // Azure AD object ID (oid claim)

    /** Override personal de MCP Resource URI patterns. Null = hereda del department ceiling. */
    @Column({ type: 'jsonb', nullable: true })
    vaultResources?: string[] | null;

    /** Department del usuario — define el resource ceiling y enruta al agente correcto. */
    @Column({ type: 'varchar', length: 100, nullable: true })
    department?: string | null;

    @OneToMany(() => UserApplication, (ua) => ua.user)
    userApplications!: UserApplication[];

    @BeforeInsert()
    async hashPassword?(): Promise<void> {
        if (this.passwordHash && !this.passwordHash.startsWith('$2')) {
            this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
        }
    }

    @BeforeInsert()
    @BeforeUpdate()
    async setCompleteName(): Promise<void> {
        this.completeName = `${this.firstName} ${this.lastName}`;
    }

}