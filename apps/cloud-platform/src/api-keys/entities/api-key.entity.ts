import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('api_keys')
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, nullable: false })
  name: string;

  /** SHA-256 of the plain-text key — the plain-text is returned once at creation and never stored. */
  @Column({ type: 'varchar', length: 64, unique: true, nullable: false })
  keyHash: string;

  /** Optional scope list. Empty = all scopes allowed. */
  @Column({ type: 'simple-array', nullable: true })
  scopes: string[] | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'timestamp with time zone', nullable: true })
  lastUsedAt: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
