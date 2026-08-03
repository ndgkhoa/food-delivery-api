import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * Dedupe ledger for the inventory command consumer: one row per consumed
 * command event id, written in the same transaction as the reply-outbox append.
 * A re-delivered command's insert hits the PK unique-violation → the reply is
 * appended at most once (the reserve/release effect is idempotent on its own).
 */
@Entity('processed_events')
export class ProcessedEventOrmEntity {
  @PrimaryColumn({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @CreateDateColumn({ name: 'processed_at' })
  processedAt!: Date;
}
