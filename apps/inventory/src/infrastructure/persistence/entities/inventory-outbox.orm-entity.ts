import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Polling-outbox row for inventory replies: the relay drains unpublished rows,
 * produces them to Kafka (key = order id), then stamps `published_at`. `id`
 * becomes the event id (`x-event-id` + downstream dedupe key). A partial index
 * on unpublished rows keeps the relay's hot path cheap.
 */
@Entity('inventory_outbox')
@Index('idx_inventory_outbox_unpublished', ['createdAt'], { where: '"published_at" IS NULL' })
export class InventoryOutboxOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'aggregate_id', type: 'uuid' })
  aggregateId!: string;

  @Column({ type: 'varchar', length: 120 })
  topic!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 100 })
  eventType!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'correlation_id', type: 'uuid' })
  correlationId!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;
}
