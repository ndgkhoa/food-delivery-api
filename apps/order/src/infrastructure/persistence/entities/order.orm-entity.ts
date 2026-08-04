import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

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

  @Column({ name: 'restaurant_id', type: 'uuid', nullable: true })
  restaurantId!: string | null;

  @Column({ type: 'varchar', length: 20 })
  status!: string;

  @Column({ name: 'subtotal_cents', type: 'integer' })
  subtotalCents!: number;

  @Column({ name: 'delivery_fee_cents', type: 'integer' })
  deliveryFeeCents!: number;

  @Column({ name: 'vat_cents', type: 'integer' })
  vatCents!: number;

  @Column({ name: 'discount_cents', type: 'integer' })
  discountCents!: number;

  @Column({ name: 'total_cents', type: 'integer' })
  totalCents!: number;

  @VersionColumn()
  version!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
