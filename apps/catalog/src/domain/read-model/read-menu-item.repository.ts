import type { MenuItem } from '@catalog/domain/menu-item/menu-item';
import type { PageResult, Pagination } from '@catalog/domain/shared/pagination';

/** Denormalized row the projection consumer upserts and the read endpoints serve. */
export interface ReadMenuItemRow {
  id: string;
  restaurantId: string;
  tenantId: string;
  name: string;
  description: string | null;
  priceCents: number;
  isAvailable: boolean;
  /** Projected from the write model's version — see `read-menu-item.orm-entity.ts`. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Query + projection port for the menu-item read model. Reads return domain
 * `MenuItem` aggregates so the existing response mappers are reused as-is;
 * `upsert`/`remove` are the projection's write path (idempotent by PK).
 */
export interface ReadMenuItemRepository {
  findAndCountByRestaurant(
    tenantId: string,
    restaurantId: string,
    pagination: Pagination,
  ): Promise<PageResult<MenuItem>>;
  upsert(row: ReadMenuItemRow): Promise<void>;
  remove(id: string, tenantId: string): Promise<void>;
  /** Cascade for a `RestaurantDeleted` event: drop every menu-item read row of that restaurant. */
  removeByRestaurant(restaurantId: string, tenantId: string): Promise<void>;
}

export const READ_MENU_ITEM_REPOSITORY = Symbol('ReadMenuItemRepository');
