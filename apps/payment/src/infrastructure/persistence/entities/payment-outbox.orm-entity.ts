import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Polling-outbox row for payment replies: the relay drains unpublished rows,
 * produces them to Kafka (key = order id), then stamps `published_at`. `id`
 * becomes the event id. A partial index on unpublished rows keeps the relay's
 * hot path cheap.
 */
@Entity('payment_outbox')
@Index('idx_payment_outbox_unpublished', ['createdAt'], { where: '"published_at" IS NULL' })
export class PaymentOutboxOrmEntity {
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

  /**
   * W3C traceparent captured synchronously at append time (the request/handler
   * transaction), so the relay's later publish tick can forward the ORIGINAL
   * request's trace context instead of starting a fresh one — see
   * `captureActiveTraceContext` in `@food-delivery-api/shared-observability`.
   * Null when telemetry is off or no span was active; the producer then falls
   * back to its own per-hop injection.
   */
  @Column({ name: 'trace_parent', type: 'varchar', length: 64, nullable: true })
  traceParent!: string | null;
}
