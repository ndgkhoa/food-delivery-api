import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Restaurant } from '../../../domain/restaurant/restaurant';
import {
  RESTAURANT_REPOSITORY,
  type RestaurantRepository,
} from '../../../domain/restaurant/restaurant.repository';
import {
  TENANT_CONTEXT_PORT,
  type TenantContextPort,
} from '../../../domain/shared/tenant-context.port';

/** Also depended on by menu-item command/query handlers to 404 + tenant-scope-check the parent restaurant. */
@Injectable()
export class GetRestaurantHandler {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  async execute(id: string): Promise<Restaurant> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const restaurant = await this.restaurantRepository.findById(id, tenantId);

    if (!restaurant) {
      throw new NotFoundException(`Restaurant "${id}" not found`);
    }

    return restaurant;
  }
}
