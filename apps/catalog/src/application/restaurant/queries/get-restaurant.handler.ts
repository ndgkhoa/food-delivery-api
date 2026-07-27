import type { Restaurant } from '@catalog/domain/restaurant/restaurant';
import {
  RESTAURANT_REPOSITORY,
  type RestaurantRepository,
} from '@catalog/domain/restaurant/restaurant.repository';
import { EntityNotFoundError } from '@catalog/domain/shared/errors';
import {
  TENANT_CONTEXT_PORT,
  type TenantContextPort,
} from '@catalog/domain/shared/tenant-context.port';
import { Inject, Injectable } from '@nestjs/common';

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
      throw new EntityNotFoundError('Restaurant', id);
    }

    return restaurant;
  }
}
