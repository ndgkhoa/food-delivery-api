import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('review_eligible_orders')
export class ReviewEligibleOrderOrmEntity {
  @PrimaryColumn({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'restaurant_id', type: 'uuid' })
  restaurantId!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
