import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('outbox')
export class OutboxOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  aggregatetype!: string;

  @Column({ type: 'uuid' })
  aggregateid!: string;

  @Column({ type: 'varchar', length: 100 })
  type!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid', nullable: true })
  correlationid!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
