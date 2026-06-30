import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('directors')
export class Director {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  agentId: string;

  @Column({ default: 'stopped' })
  status: string;

  @Column({ nullable: true })
  containerId: string;

  @Column({ default: '1.0.0' })
  version: string;

  @Column({ type: 'json', nullable: true })
  config: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  deployedAt: Date;
}