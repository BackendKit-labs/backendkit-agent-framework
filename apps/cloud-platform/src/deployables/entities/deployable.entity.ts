import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type { RuntimeKind } from '../../runtime/runtime.spi';
import { Department } from '../../departments/entities/department.entity';

export type DeployableKind = 'agent' | 'app';
export type DeployableStatus = 'pending' | 'starting' | 'running' | 'stopped' | 'error';
export type AppFramework = 'nextjs' | 'fastapi' | 'express' | 'custom';

@Entity('deployables')
export class Deployable {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 10, default: 'agent' })
  kind: DeployableKind;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: DeployableStatus;

  // ── Department (area de negocio) ─────────────────────────────────────────
  @Column({ type: 'uuid', nullable: true })
  departmentId: string | null;

  @ManyToOne(() => Department, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'departmentId' })
  department: Department | null;

  // ── Catalog / image ──────────────────────────────────────────────────────
  /** Key referencing CatalogEntry (e.g. 'knowledge-vault', 'hr-onboarding'). */
  @Column({ type: 'varchar', length: 100, nullable: true })
  catalogKey: string | null;

  /** OCI image override — if null, resolved from CatalogEntry. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  image: string | null;

  /** Runtime adapter to use for deployment. */
  @Column({ type: 'varchar', length: 20, default: 'docker' })
  runtime: RuntimeKind;

  /** Adapter-native handle (container id / pod name / pid). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  runtimeHandle: string | null;

  // ── Agent-specific ───────────────────────────────────────────────────────
  @Column({ type: 'varchar', length: 100, nullable: true })
  model: string | null;

  @Column({ type: 'int', nullable: true })
  mcpPort: number | null;

  // ── App-specific ─────────────────────────────────────────────────────────
  @Column({ type: 'int', nullable: true })
  publicPort: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  publicUrl: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  framework: AppFramework | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
