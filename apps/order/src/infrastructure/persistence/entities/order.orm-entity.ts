import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

/**
 * The order aggregate root. `id` is app-generated (not a DB serial/uuid
 * default) because `PlaceOrderHandler` needs the id BEFORE the row exists, to
 * claim the idempotency mapping first. `version` backs optimistic-lock
 * updates — see `TypeOrmOrderRepository.save`, which performs its own
 * conditional `UPDATE ... WHERE version = :version` rather than relying on
 * TypeORM's automatic version-check machinery (which only engages via an
 * explicit `lock: { mode: 'optimistic' }` read). No relation to
 * `OrderItemOrmEntity` here — see the note in that file re: import cycles.
 */
@Entity('orders')
@Index(['tenantId'])
@Index(['tenantId', 'userId'])
export class OrderOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 255 })
  userId!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: string;

  @Column({ name: 'total_cents', type: 'integer' })
  totalCents!: number;

  @VersionColumn()
  version!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
