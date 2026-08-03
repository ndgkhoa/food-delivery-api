import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * Keyed naturally by (tenant_id, user_id, key) — a composite primary key, so
 * a duplicate claim raises a real Postgres unique_violation (23505) that
 * `TypeOrmIdempotencyRepository.save` surfaces to the caller, rather than
 * silently upserting.
 */
@Entity('idempotency_keys')
export class IdempotencyKeyOrmEntity {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'varchar', length: 255 })
  userId!: string;

  @PrimaryColumn({ type: 'varchar', length: 255 })
  key!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
