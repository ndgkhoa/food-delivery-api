import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Insert-only CDC outbox row. Column names match the Debezium Outbox Event
 * Router field convention (lowercase, no camelCase) so the SMT maps them
 * without per-field renames. `id` becomes the event id (dedupe key),
 * `aggregateid` the Kafka key, `type` the event type, `payload` the message
 * body. `tenant_id`/`correlationid` ride as headers.
 */
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
