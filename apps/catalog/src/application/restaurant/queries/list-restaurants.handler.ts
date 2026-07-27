import type { Restaurant } from '@catalog/domain/restaurant/restaurant';
import {
  RESTAURANT_REPOSITORY,
  type RestaurantRepository,
} from '@catalog/domain/restaurant/restaurant.repository';
import type { PaginatedResult, Pagination } from '@catalog/domain/shared/pagination';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class ListRestaurantsHandler {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  async execute(pagination: Pagination): Promise<PaginatedResult<Restaurant>> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const { data, total } = await this.restaurantRepository.findAndCount(tenantId, pagination);

    return { data, total, page: pagination.page, limit: pagination.limit };
  }
}
