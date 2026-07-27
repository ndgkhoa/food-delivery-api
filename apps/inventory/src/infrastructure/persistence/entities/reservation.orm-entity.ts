import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A single item's stock hold for an order. `status` transitions ACTIVE→RELEASED;
 * the (tenant_id, order_id) index backs reserve idempotency and release lookups.
 */
@Entity('reservations')
@Index(['tenantId'])
@Index(['tenantId', 'orderId'])
export class ReservationOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId!: string;

  @Column({ type: 'integer' })
  qty!: number;

  @Column({ type: 'varchar', length: 20 })
  status!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
