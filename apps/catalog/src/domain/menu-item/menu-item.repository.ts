import type { MenuItem } from '@catalog/domain/menu-item/menu-item';
import type { PageResult, Pagination } from '@catalog/domain/shared/pagination';

export interface MenuItemRepository {
  save(menuItem: MenuItem): Promise<MenuItem>;
  findById(id: string, restaurantId: string, tenantId: string): Promise<MenuItem | null>;
  /**
   * Bulk lookup by id within a tenant, for east-west callers (order/inventory
   * over gRPC) that validate a cart's items. Restaurant-agnostic on purpose —
   * a cart may span restaurants. Missing/soft-deleted ids are simply absent.
   */
  findManyByIds(ids: string[], tenantId: string): Promise<MenuItem[]>;
  findAndCountByRestaurant(
    tenantId: string,
    restaurantId: string,
    pagination: Pagination,
  ): Promise<PageResult<MenuItem>>;
  softDelete(id: string, tenantId: string): Promise<void>;
  /** Cascades a soft-delete to every menu item of a restaurant when its parent is soft-deleted. */
  softDeleteByRestaurant(restaurantId: string, tenantId: string): Promise<void>;
}

export const MENU_ITEM_REPOSITORY = Symbol('MenuItemRepository');
