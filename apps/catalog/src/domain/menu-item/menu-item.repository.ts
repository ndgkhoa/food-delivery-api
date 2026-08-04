import type { MenuItem } from '@catalog/domain/menu-item/menu-item';
import type { PageResult, Pagination } from '@catalog/domain/shared/pagination';

export interface MenuItemRepository {
  save(menuItem: MenuItem): Promise<MenuItem>;
  updateVersioned(menuItem: MenuItem): Promise<MenuItem>;
  findById(id: string, restaurantId: string, tenantId: string): Promise<MenuItem | null>;
  findManyByIds(ids: string[], tenantId: string): Promise<MenuItem[]>;
  findAndCountByRestaurant(
    tenantId: string,
    restaurantId: string,
    pagination: Pagination,
  ): Promise<PageResult<MenuItem>>;
  findAllByRestaurant(restaurantId: string, tenantId: string): Promise<MenuItem[]>;
  softDelete(id: string, tenantId: string): Promise<void>;
  softDeleteByRestaurant(restaurantId: string, tenantId: string): Promise<void>;
}

export const MENU_ITEM_REPOSITORY = Symbol('MenuItemRepository');
