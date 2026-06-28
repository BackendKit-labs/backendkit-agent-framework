import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export type CatalogEntryKind = 'agent' | 'app';

@Entity('catalog_entries')
export class CatalogEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Unique slug used in Deployable.catalogKey (e.g. "codex", "hr-assistant"). */
  @Column({ type: 'varchar', length: 100, unique: true })
  key: string;

  @Column({ type: 'varchar', length: 255 })
  displayName: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Business category — e.g. "knowledge", "dev", "hr", "finance", "ops", "infra". */
  @Column({ type: 'varchar', length: 50, default: 'custom' })
  category: string;

  @Column({ type: 'varchar', length: 20, default: 'agent' })
  kind: CatalogEntryKind;

  @Column({ type: 'varchar', length: 255 })
  image: string;

  /** Docker command override (optional). Stored as CSV. */
  @Column({ type: 'simple-array', nullable: true })
  command: string[] | null;

  /** Default environment variables injected at deploy time (lowest priority). */
  @Column({ type: 'jsonb', nullable: true })
  env: Record<string, string> | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  defaultModel: string | null;

  @Column({ type: 'varchar', length: 20, default: 'docker' })
  runtime: string;

  /**
   * Department secrets that MUST exist before this entry can be deployed.
   * If a required key is missing, the deploy is rejected with a 400 listing
   * the missing secrets so the operator knows what to configure.
   */
  @Column({ type: 'simple-array', nullable: true })
  requiredSecrets: string[] | null;

  /** When false, the entry is hidden from non-admin catalog listings. */
  @Column({ type: 'boolean', default: true })
  isPublic: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
