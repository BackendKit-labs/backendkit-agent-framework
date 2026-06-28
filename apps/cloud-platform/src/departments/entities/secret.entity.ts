import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Department } from './department.entity';

@Entity('department_secrets')
@Unique(['departmentId', 'key'])
export class Secret {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: false })
  departmentId: string;

  @ManyToOne(() => Department, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'departmentId' })
  department: Department;

  @Column({ type: 'varchar', length: 100, nullable: false })
  key: string;

  // plaintext in Fase 1 — add AES-256-GCM encryption when multi-tenant
  @Column({ type: 'text', nullable: false })
  value: string;

  @CreateDateColumn()
  createdAt: Date;
}
