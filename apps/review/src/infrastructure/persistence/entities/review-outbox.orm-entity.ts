import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Polling-outbox row: an app relay drains unpublished rows and produces them
 * to Kafka, then stamps `published_at`. Mirrors `order_outbox`
 * (`apps/order/src/infrastructure/persistence/entities/order-outbox.orm-entity.ts`).
 * `id` becomes the event id (downstream dedupe key + `x-event-id`),
 * `aggregate_id` (restaurant id) the Kafka message key for per-restaurant
 * ordering, `topic` the destination (`review.events`).
 */
@Entity('review_outbox')
@Index('idx_review_outbox_unpublished', ['createdAt'], { where: '"published_at" IS NULL' })
export class ReviewOutboxOrmEntity {
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
