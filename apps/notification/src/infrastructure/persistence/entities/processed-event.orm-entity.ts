import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * Dedupe ledger for the order.events consumer: one row per consumed event id,
 * written in the same transaction as the notification row batch. A
 * re-delivered order lifecycle event hits the PK unique-violation → no
 * duplicate rows/jobs.
 */
@Entity('processed_events')
export class ProcessedEventOrmEntity {
  @PrimaryColumn({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @CreateDateColumn({ name: 'processed_at' })
  processedAt!: Date;
}
