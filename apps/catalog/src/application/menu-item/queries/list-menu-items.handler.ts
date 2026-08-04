import { GetRestaurantHandler } from '@catalog/application/restaurant/queries/get-restaurant.handler';
import type { MenuItem } from '@catalog/domain/menu-item/menu-item';
import {
  READ_MENU_ITEM_REPOSITORY,
  type ReadMenuItemRepository,
} from '@catalog/domain/read-model/read-menu-item.repository';
import type { PaginatedResult, Pagination } from '@catalog/domain/shared/pagination';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class ListMenuItemsHandler {
  constructor(
    @Inject(READ_MENU_ITEM_REPOSITORY)
    private readonly readMenuItemRepository: ReadMenuItemRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    private readonly getRestaurant: GetRestaurantHandler,
  ) {}

  async execute(restaurantId: string, pagination: Pagination): Promise<PaginatedResult<MenuItem>> {
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
