import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Workflow } from './workflow.entity';
import { Deployable } from '../../deployables/entities/deployable.entity';

@Entity('workflow_steps')
export class WorkflowStep {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  workflowId: string;

  @ManyToOne(() => Workflow, (wf) => wf.steps, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workflowId' })
  workflow: Workflow;

  /** 1-based execution order within the workflow. */
  @Column({ type: 'int' })
  order: number;

  @Column({ type: 'uuid', nullable: true })
  deployableId: string | null;

  @ManyToOne(() => Deployable, { onDelete: 'SET NULL', nullable: true, eager: false })
  @JoinColumn({ name: 'deployableId' })
  deployable: Deployable | null;

  /** Arbitrary step config — e.g. prompt template, timeout, retry count. */
  @Column({ type: 'jsonb', nullable: true })
  config: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;
}
