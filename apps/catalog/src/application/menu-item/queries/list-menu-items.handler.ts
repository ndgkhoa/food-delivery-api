import { GetRestaurantHandler } from '@catalog/application/restaurant/queries/get-restaurant.handler';
import type { MenuItem } from '@catalog/domain/menu-item/menu-item';
import {
  READ_MENU_ITEM_REPOSITORY,
  type ReadMenuItemRepository,
} from '@catalog/domain/read-model/read-menu-item.repository';
import type { PaginatedResult, Pagination } from '@catalog/domain/shared/pagination';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';

/**
 * Lists a restaurant's menu from the CQRS read model. Parent existence +
 * tenant ownership are still validated against the write model (strongly
 * consistent) so a just-created restaurant never spuriously 404s while its
 * projection catches up; only the item rows are served eventually-consistent.
 */
@Injectable()
export class ListMenuItemsHandler {
  constructor(
    @Inject(READ_MENU_ITEM_REPOSITORY)
    private readonly readMenuItemRepository: ReadMenuItemRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    private readonly getRestaurant: GetRestaurantHandler,
  ) {}

  async execute(restaurantId: string, pagination: Pagination): Promise<PaginatedResult<MenuItem>> {
    // Confirms the restaurant exists AND belongs to the caller's tenant before listing its menu items.
    await this.getRestaurant.execute(restaurantId);
    const tenantId = this.tenantContext.getTenantIdOrThrow();

    const { data, total } = await this.readMenuItemRepository.findAndCountByRestaurant(
      tenantId,
      restaurantId,
      pagination,
    );

    return { data, total, page: pagination.page, limit: pagination.limit };
  }
}
