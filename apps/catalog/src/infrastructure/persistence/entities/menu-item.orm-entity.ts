import { RestaurantOrmEntity } from '@catalog/infrastructure/persistence/entities/restaurant.orm-entity';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

@Entity('menu_items')
@Index(['tenantId'])
@Index(['restaurantId'])
export class MenuItemOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'restaurant_id', type: 'uuid' })
  restaurantId!: string;

  @ManyToOne(
    () => RestaurantOrmEntity,
    (restaurant) => restaurant.menuItems,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'restaurant_id' })
  restaurant?: RestaurantOrmEntity;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** Price stored as integer cents to avoid floating-point rounding errors. */
  @Column({ name: 'price_cents', type: 'integer' })
  priceCents!: number;

  @Column({ name: 'is_available', type: 'boolean', default: true })
  isAvailable!: boolean;

  /** Backs optimistic-lock updates — see `TypeOrmMenuItemRepository.updateVersioned`. */
  @VersionColumn()
  version!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt!: Date | null;
}
