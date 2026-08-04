import type { MenuItem } from '@catalog/domain/menu-item/menu-item';
import type { PageResult, Pagination } from '@catalog/domain/shared/pagination';

export interface ReadMenuItemRow {
  id: string;
  restaurantId: string;
  tenantId: string;
  name: string;
  description: string | null;
  priceCents: number;
  isAvailable: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReadMenuItemRepository {
  findAndCountByRestaurant(
    tenantId: string,
    restaurantId: string,
    pagination: Pagination,
  ): Promise<PageResult<MenuItem>>;
  upsert(row: ReadMenuItemRow): Promise<void>;
  remove(id: string, tenantId: string): Promise<void>;
  removeByRestaurant(restaurantId: string, tenantId: string): Promise<void>;
}

export const READ_MENU_ITEM_REPOSITORY = Symbol('ReadMenuItemRepository');
