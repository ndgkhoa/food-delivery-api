import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * Dedupe ledger for the saga reply consumers: one row per consumed event id.
 * The PK is the event id itself, so a re-delivered reply's insert hits a
 * unique-violation the store translates into a skip — the saga transition is
 * applied at most once. Event ids are globally unique UUIDs, so a single
 * ledger safely covers both reply topics.
 */
@Entity('processed_events')
export class ProcessedEventOrmEntity {
  @PrimaryColumn({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @CreateDateColumn({ name: 'processed_at' })
  processedAt!: Date;
}
