import {
  READ_RESTAURANT_REPOSITORY,
  type ReadRestaurantRepository,
} from '@catalog/domain/read-model/read-restaurant.repository';
import type { Restaurant } from '@catalog/domain/restaurant/restaurant';
import { EntityNotFoundError } from '@catalog/domain/shared/errors';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';

/**
 * Serves `GET /restaurants/:id` from the CQRS read model (eventually consistent
 * with writes). Distinct from `GetRestaurantHandler`, which stays on the write
 * model because command handlers depend on it for strongly-consistent
 * parent-existence checks.
 */
@Injectable()
export class GetRestaurantViewHandler {
  constructor(
    @Inject(READ_RESTAURANT_REPOSITORY)
    private readonly readRestaurantRepository: ReadRestaurantRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  async execute(id: string): Promise<Restaurant> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const restaurant = await this.readRestaurantRepository.findById(id, tenantId);

    if (!restaurant) {
      throw new EntityNotFoundError('Restaurant', id);
    }

    return restaurant;
  }
}
