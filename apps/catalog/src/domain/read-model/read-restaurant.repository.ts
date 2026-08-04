import type { Restaurant } from '@catalog/domain/restaurant/restaurant';
import type { PageResult, Pagination } from '@catalog/domain/shared/pagination';

export interface ReadRestaurantRow {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReadRestaurantRepository {
  findById(id: string, tenantId: string): Promise<Restaurant | null>;
  findAndCount(tenantId: string, pagination: Pagination): Promise<PageResult<Restaurant>>;
  upsert(row: ReadRestaurantRow): Promise<void>;
  remove(id: string, tenantId: string): Promise<void>;
  updateRating(id: string, tenantId: string, rating: number, reviewCount: number): Promise<void>;
}

export const READ_RESTAURANT_REPOSITORY = Symbol('ReadRestaurantRepository');
