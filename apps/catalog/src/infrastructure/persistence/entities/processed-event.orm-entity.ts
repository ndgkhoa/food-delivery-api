import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * Dedupe ledger for the projection consumer: one row per consumed event id.
 * The PK is the event id itself, so a re-delivered event's insert hits a
 * unique-violation the store translates into a skip — the read-model upsert is
 * applied at most once.
 */
@Entity('processed_events')
export class ProcessedEventOrmEntity {
  @PrimaryColumn({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @CreateDateColumn({ name: 'processed_at' })
  processedAt!: Date;
}
