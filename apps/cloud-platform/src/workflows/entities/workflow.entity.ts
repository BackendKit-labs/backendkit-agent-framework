import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Department } from '../../departments/entities/department.entity';
import { WorkflowStep } from './workflow-step.entity';

export type WorkflowStatus = 'draft' | 'active' | 'paused';
export type WorkflowTrigger = 'manual' | 'webhook' | 'scheduled';

@Entity('workflows')
export class Workflow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status: WorkflowStatus;

  @Column({ type: 'varchar', length: 20, default: 'manual' })
  trigger: WorkflowTrigger;

  @Column({ type: 'uuid', nullable: true })
  departmentId: string | null;

  @ManyToOne(() => Department, { onDelete: 'SET NULL', nullable: true, eager: false })
  @JoinColumn({ name: 'departmentId' })
  department: Department | null;

  @OneToMany(() => WorkflowStep, (step) => step.workflow, { cascade: true, eager: false })
  steps: WorkflowStep[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
