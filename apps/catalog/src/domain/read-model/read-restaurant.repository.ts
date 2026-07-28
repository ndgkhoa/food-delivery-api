import type { Restaurant } from '@catalog/domain/restaurant/restaurant';
import type { PageResult, Pagination } from '@catalog/domain/shared/pagination';

/** Denormalized row the projection consumer upserts and the read endpoints serve. */
export interface ReadRestaurantRow {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Query + projection port for the restaurant read model. Reads return domain
 * `Restaurant` aggregates so the existing response mappers are reused as-is;
 * `upsert`/`remove` are the projection's write path (idempotent by PK).
 */
export interface ReadRestaurantRepository {
  findById(id: string, tenantId: string): Promise<Restaurant | null>;
  findAndCount(tenantId: string, pagination: Pagination): Promise<PageResult<Restaurant>>;
  upsert(row: ReadRestaurantRow): Promise<void>;
  remove(id: string, tenantId: string): Promise<void>;
}

export const READ_RESTAURANT_REPOSITORY = Symbol('ReadRestaurantRepository');
