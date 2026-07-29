import type {
  ChannelName,
  NotificationStatus,
} from '@notification/domain/notification/notification';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One row per (event id, channel). The unique index backs up the
 * `processed_events` dedupe at the DB level (belt-and-suspenders: the
 * app-level check runs first inside the same transaction; this catches
 * anything that slips past it).
 */
@Entity('notifications')
@Index(['eventId', 'channel'], { unique: true })
export class NotificationOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @Column({ type: 'varchar', length: 20 })
  channel!: ChannelName;

  @Column({ type: 'varchar', length: 255 })
  recipient!: string;

  @Column({ type: 'varchar', length: 50 })
  type!: string;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: NotificationStatus;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
