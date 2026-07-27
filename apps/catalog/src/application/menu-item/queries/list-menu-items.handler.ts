import { Inject, Injectable } from '@nestjs/common';
import type { MenuItem } from '../../../domain/menu-item/menu-item';
import {
  MENU_ITEM_REPOSITORY,
  type MenuItemRepository,
} from '../../../domain/menu-item/menu-item.repository';
import type { PaginatedResult, Pagination } from '../../../domain/shared/pagination';
import {
  TENANT_CONTEXT_PORT,
  type TenantContextPort,
} from '../../../domain/shared/tenant-context.port';
import { GetRestaurantHandler } from '../../restaurant/queries/get-restaurant.handler';

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
