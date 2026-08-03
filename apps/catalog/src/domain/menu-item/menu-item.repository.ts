import type { MenuItem } from '@catalog/domain/menu-item/menu-item';
import type { PageResult, Pagination } from '@catalog/domain/shared/pagination';

export interface MenuItemRepository {
  /** Inserts a brand-new aggregate (`MenuItem.create()`'d, never persisted before). */
  save(menuItem: MenuItem): Promise<MenuItem>;
  /**
   * Optimistic-lock conditional update: succeeds only if the row's version in
   * the DB still matches `menuItem.version` (the version this aggregate was
   * loaded at), atomically bumping it by 1. Throws `ConcurrencyConflictError`
   * when a concurrent writer already moved the version on since the load.
   */
  updateVersioned(menuItem: MenuItem): Promise<MenuItem>;
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
  /**
   * Every live menu item of a restaurant (unpaginated). Used when a restaurant
   * is deleted to emit one delete event per item, keyed by the item id so each
   * item's own partition sees its terminal event in order — the read model can
   * never keep an orphan item pointing at a removed restaurant.
   */
  findAllByRestaurant(restaurantId: string, tenantId: string): Promise<MenuItem[]>;
  softDelete(id: string, tenantId: string): Promise<void>;
  /** Cascades a soft-delete to every menu item of a restaurant when its parent is soft-deleted. */
  softDeleteByRestaurant(restaurantId: string, tenantId: string): Promise<void>;
}

export const MENU_ITEM_REPOSITORY = Symbol('MenuItemRepository');
