import {
  READ_RESTAURANT_REPOSITORY,
  type ReadRestaurantRepository,
} from '@catalog/domain/read-model/read-restaurant.repository';
import type { Restaurant } from '@catalog/domain/restaurant/restaurant';
import { RESTAURANT_CACHE_TTL_MS, restaurantCacheKey } from '@catalog/domain/shared/cache-keys';
import { EntityNotFoundError } from '@catalog/domain/shared/errors';
import {
  fromRestaurantCacheSnapshot,
  type RestaurantCacheSnapshot,
  toRestaurantCacheSnapshot,
} from '@catalog/domain/shared/restaurant-cache-snapshot';
import { REDIS_CACHE, type RedisCache } from '@food-delivery-api/shared-cache';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class GetRestaurantViewHandler {
  constructor(
    @Inject(READ_RESTAURANT_REPOSITORY)
    private readonly readRestaurantRepository: ReadRestaurantRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    @Inject(REDIS_CACHE) private readonly cache: RedisCache,
  ) {}

  async execute(id: string): Promise<Restaurant> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const key = restaurantCacheKey(tenantId, id);

    const snapshot = await this.cache.cacheAside<RestaurantCacheSnapshot | null>(
      key,
      RESTAURANT_CACHE_TTL_MS,
      async () => {
        const restaurant = await this.readRestaurantRepository.findById(id, tenantId);
        return restaurant ? toRestaurantCacheSnapshot(restaurant) : null;
      },
    );

    if (!snapshot) {
      throw new EntityNotFoundError('Restaurant', id);
    }

    return fromRestaurantCacheSnapshot(snapshot);
  }
}
