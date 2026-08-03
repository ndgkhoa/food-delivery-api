import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Denormalized restaurant read row, kept eventually consistent by the
 * projection consumer. No soft-delete column — a delete event removes the row
 * outright, since the read model only ever serves live rows. The PK mirrors the
 * write-model restaurant id so upserts are idempotent.
 */
@Entity('read_restaurants')
@Index(['tenantId'])
export class ReadRestaurantOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  /**
   * Aggregate rating fed by the review service's `RestaurantRatingChanged`
   * events — never written by the `catalog.events` projection (see the
   * repository adapter's `updateRating`, kept separate from `upsert`).
   */
  @Column({ type: 'real', default: 0 })
  rating!: number;

  @Column({ name: 'review_count', type: 'integer', default: 0 })
  reviewCount!: number;

  /**
   * Optimistic-lock version projected from the write model's `restaurants.version`
   * (see `AddVersionToRestaurantsAndMenuItems1754250000000`). Plain `integer`, not
   * a TypeORM `@VersionColumn()` — this row is never saved via `Repository.save()`
   * (only the explicit-column upsert), so a version guard here would be inert; the
   * column exists purely so `If-Match` reads (GET) see the same version the write
   * aggregate enforces on PATCH.
   */
  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
