import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * Dedupe ledger for the `order.events` eligibility consumer: one row per
 * consumed event id, written in the same transaction as the eligibility
 * upsert. A re-delivered `OrderConfirmed` hits the PK unique-violation → no
 * duplicate/redundant write.
 */
@Entity('processed_events')
export class ProcessedEventOrmEntity {
  @PrimaryColumn({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @CreateDateColumn({ name: 'processed_at' })
  processedAt!: Date;
}
