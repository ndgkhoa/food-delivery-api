import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

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
