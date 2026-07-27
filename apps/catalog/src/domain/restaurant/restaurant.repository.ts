import type { PageResult, Pagination } from '../shared/pagination';
import type { Restaurant } from './restaurant';

export interface RestaurantRepository {
  save(restaurant: Restaurant): Promise<Restaurant>;
  findById(id: string, tenantId: string): Promise<Restaurant | null>;
  findAndCount(tenantId: string, pagination: Pagination): Promise<PageResult<Restaurant>>;
  softDelete(id: string, tenantId: string): Promise<void>;
}

export const RESTAURANT_REPOSITORY = Symbol('RestaurantRepository');
