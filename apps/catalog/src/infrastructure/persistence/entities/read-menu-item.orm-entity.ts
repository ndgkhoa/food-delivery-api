import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Denormalized menu-item read row, kept eventually consistent by the
 * projection consumer. No soft-delete column — a delete event removes the row
 * outright. The PK mirrors the write-model menu-item id so upserts are
 * idempotent.
 */
@Entity('read_menu_items')
@Index(['tenantId'])
@Index(['restaurantId'])
export class ReadMenuItemOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'restaurant_id', type: 'uuid' })
  restaurantId!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'price_cents', type: 'integer' })
  priceCents!: number;

  @Column({ name: 'is_available', type: 'boolean', default: true })
  isAvailable!: boolean;

  /**
   * Optimistic-lock version projected from the write model's `menu_items.version`
   * (see `AddVersionToRestaurantsAndMenuItems1754250000000`). Plain `integer`, not
   * a TypeORM `@VersionColumn()` — this row is upserted via `Repository.upsert()`,
   * not `save()`, so a version guard here would be inert; the column exists purely
   * so `If-Match` reads (GET) see the same version the write aggregate enforces on
   * PATCH.
   */
  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
