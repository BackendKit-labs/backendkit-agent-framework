import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { RuntimeKind } from '../../runtime/runtime.spi';

export enum AgentStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ERROR = 'error',
  STOPPED = 'stopped',
}

@Entity('agents')
export class Agent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true, nullable: false })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 100, nullable: false })
  type: string;

  @Column({
    type: 'enum',
    enum: AgentStatus,
    default: AgentStatus.INACTIVE,
  })
  status: AgentStatus;

  @Column({ type: 'json', nullable: true })
  config: Record<string, any> | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  projectId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  model: string | null;

  // ── Runtime (Fase 1: RuntimeSPI) ────────────────────────────────────────
  /** Which runtime adapter deploys this agent (docker | k8s | process). */
  @Column({ type: 'varchar', length: 20, default: 'docker' })
  runtime: RuntimeKind;

  /** OCI image to deploy. Falls back to config.image / DEFAULT_AGENT_IMAGE. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  image: string | null;

  /** Adapter-native handle of the deployed instance (container id / pod / pid). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  runtimeHandle: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}