import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Stock is keyed naturally by (tenant_id, item_id) — a composite primary key,
 * so `save` upserts the right row without a surrogate id and the domain aggregate
 * maps 1:1. A DB CHECK (available >= 0), added in the migration, backstops the
 * no-oversell invariant at the storage layer.
 */
@Entity('stock')
@Index(['tenantId'])
export class StockOrmEntity {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @PrimaryColumn({ name: 'item_id', type: 'uuid' })
  itemId!: string;

  @Column({ type: 'integer' })
  available!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
