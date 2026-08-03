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

/**
 * Serves `GET /restaurants/:id` from the CQRS read model (eventually consistent
 * with writes), cache-aside in front of Redis: a hit skips Postgres entirely; a
 * miss loads the read-model row, caches it, and returns it. The read-model
 * projector write-throughs this same key on create/update/rating-change and
 * evicts it on delete, so a cache hit is never stale-after-write. Distinct
 * from `GetRestaurantHandler`, which stays on the write model (uncached —
 * used by command handlers for strongly-consistent parent-existence checks,
 * where a stale cache hit could let a write proceed against a deleted/changed
 * restaurant).
 */
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
