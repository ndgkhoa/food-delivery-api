import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { MenuItemOrmEntity } from './menu-item.orm-entity';

@Entity('restaurants')
@Index(['tenantId'])
export class RestaurantOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  /** Soft-delete marker — TypeORM's default `find`/`findOne` automatically excludes rows where this is set. */
  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt!: Date | null;

  // Inverse side declared with a string ref so this parent entity does not import the child at
  // runtime — breaks the bidirectional import cycle (child still owns the FK).
  @OneToMany('MenuItemOrmEntity', 'restaurant')
  menuItems?: MenuItemOrmEntity[];
}
