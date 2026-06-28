import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Workflow } from './workflow.entity';

export type WorkflowRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

@Entity('workflow_runs')
export class WorkflowRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  workflowId: string;

  @ManyToOne(() => Workflow, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workflowId' })
  workflow: Workflow;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: WorkflowRunStatus;

  /** Caller-supplied input payload (arbitrary JSON). */
  @Column({ type: 'jsonb', nullable: true })
  input: Record<string, any> | null;

  /** Accumulated step outputs; keyed by step id. */
  @Column({ type: 'jsonb', nullable: true })
  output: Record<string, any> | null;

  /** Error message when status = 'failed'. */
  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
