import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A single order line item. Items are immutable once inserted — only the
 * parent order's `status`/`version` change. No TypeORM relation to
 * `OrderOrmEntity` on purpose (that would create an import cycle between the
 * two entity files); the join is a plain `order_id` column, and
 * `TypeOrmOrderRepository` loads/saves both sides explicitly.
 */
@Entity('order_items')
@Index(['orderId'])
export class OrderItemOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId!: string;

  @Column({ type: 'integer' })
  qty!: number;

  @Column({ name: 'unit_price_cents', type: 'integer' })
  unitPriceCents!: number;

  @Column({ name: 'line_total_cents', type: 'integer' })
  lineTotalCents!: number;
}
