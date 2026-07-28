import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * Dedupe ledger for the payment command consumer: one row per consumed command
 * event id, written in the same transaction as the reply append. A re-delivered
 * ChargePayment hits the PK unique-violation → the reply is appended at most once.
 */
@Entity('processed_events')
export class ProcessedEventOrmEntity {
  @PrimaryColumn({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @CreateDateColumn({ name: 'processed_at' })
  processedAt!: Date;
}
