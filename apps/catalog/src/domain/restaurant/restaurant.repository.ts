import type { Restaurant } from '@catalog/domain/restaurant/restaurant';
import type { PageResult, Pagination } from '@catalog/domain/shared/pagination';

export interface RestaurantRepository {
  save(restaurant: Restaurant): Promise<Restaurant>;
  findById(id: string, tenantId: string): Promise<Restaurant | null>;
  findAndCount(tenantId: string, pagination: Pagination): Promise<PageResult<Restaurant>>;
  softDelete(id: string, tenantId: string): Promise<void>;
}

export const RESTAURANT_REPOSITORY = Symbol('RestaurantRepository');
