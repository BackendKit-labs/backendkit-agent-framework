import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Techo de MCP Resources disponibles para un department.
 * Un usuario siempre recibe la intersección de este ceiling con su vault_resources personal.
 */
@Entity('department_resources')
@Index(['department'])
export class DepartmentResource extends BaseEntity {
    @Column({ type: 'varchar', length: 100 })
    department!: string;

    /** Patrón de URI estilo glob — ej: "jira://*", "hubspot://contacts/*" */
    @Column({ type: 'varchar', length: 500 })
    uriPattern!: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    description?: string;
}
