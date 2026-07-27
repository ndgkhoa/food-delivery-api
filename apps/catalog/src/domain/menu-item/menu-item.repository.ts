import type { MenuItem } from '@catalog/domain/menu-item/menu-item';
import type { PageResult, Pagination } from '@catalog/domain/shared/pagination';

export interface MenuItemRepository {
  save(menuItem: MenuItem): Promise<MenuItem>;
  findById(id: string, restaurantId: string, tenantId: string): Promise<MenuItem | null>;
  findAndCountByRestaurant(
    tenantId: string,
    restaurantId: string,
    pagination: Pagination,
  ): Promise<PageResult<MenuItem>>;
  softDelete(id: string, tenantId: string): Promise<void>;
}

export const MENU_ITEM_REPOSITORY = Symbol('MenuItemRepository');
