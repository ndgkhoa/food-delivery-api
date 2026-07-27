import { Inject, Injectable } from '@nestjs/common';
import type { Restaurant } from '../../../domain/restaurant/restaurant';
import {
  RESTAURANT_REPOSITORY,
  type RestaurantRepository,
} from '../../../domain/restaurant/restaurant.repository';
import type { PaginatedResult, Pagination } from '../../../domain/shared/pagination';
import {
  TENANT_CONTEXT_PORT,
  type TenantContextPort,
} from '../../../domain/shared/tenant-context.port';

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
