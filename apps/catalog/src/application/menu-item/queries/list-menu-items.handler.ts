import { GetRestaurantHandler } from '@catalog/application/restaurant/queries/get-restaurant.handler';
import type { MenuItem } from '@catalog/domain/menu-item/menu-item';
import {
  MENU_ITEM_REPOSITORY,
  type MenuItemRepository,
} from '@catalog/domain/menu-item/menu-item.repository';
import type { PaginatedResult, Pagination } from '@catalog/domain/shared/pagination';
import {
  TENANT_CONTEXT_PORT,
  type TenantContextPort,
} from '@catalog/domain/shared/tenant-context.port';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class ListMenuItemsHandler {
  constructor(
    @Inject(MENU_ITEM_REPOSITORY) private readonly menuItemRepository: MenuItemRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    private readonly getRestaurant: GetRestaurantHandler,
  ) {}

  async execute(restaurantId: string, pagination: Pagination): Promise<PaginatedResult<MenuItem>> {
    // Confirms the restaurant exists AND belongs to the caller's tenant before listing its menu items.
    await this.getRestaurant.execute(restaurantId);
    const tenantId = this.tenantContext.getTenantIdOrThrow();

    const { data, total } = await this.menuItemRepository.findAndCountByRestaurant(
      tenantId,
      restaurantId,
      pagination,
    );

    return { data, total, page: pagination.page, limit: pagination.limit };
  }
}
