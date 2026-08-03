import type { Restaurant } from '@catalog/domain/restaurant/restaurant';
import type { PageResult, Pagination } from '@catalog/domain/shared/pagination';

export interface RestaurantRepository {
  /** Inserts a brand-new aggregate (`Restaurant.create()`'d, never persisted before). */
  save(restaurant: Restaurant): Promise<Restaurant>;
  /**
   * Optimistic-lock conditional update: succeeds only if the row's version in
   * the DB still matches `restaurant.version` (the version this aggregate was
   * loaded at), atomically bumping it by 1. Throws `ConcurrencyConflictError`
   * when a concurrent writer already moved the version on since the load.
   */
  updateVersioned(restaurant: Restaurant): Promise<Restaurant>;
  findById(id: string, tenantId: string): Promise<Restaurant | null>;
  findAndCount(tenantId: string, pagination: Pagination): Promise<PageResult<Restaurant>>;
  softDelete(id: string, tenantId: string): Promise<void>;
}

export const RESTAURANT_REPOSITORY = Symbol('RestaurantRepository');
