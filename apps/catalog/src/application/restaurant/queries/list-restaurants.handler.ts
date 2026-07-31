import {
  READ_RESTAURANT_REPOSITORY,
  type ReadRestaurantRepository,
} from '@catalog/domain/read-model/read-restaurant.repository';
import type { Restaurant } from '@catalog/domain/restaurant/restaurant';
import {
  RESTAURANT_LIST_CACHE_TTL_MS,
  restaurantListCacheKey,
} from '@catalog/domain/shared/cache-keys';
import type { PaginatedResult, Pagination } from '@catalog/domain/shared/pagination';
import {
  fromRestaurantCacheSnapshot,
  type RestaurantCacheSnapshot,
  toRestaurantCacheSnapshot,
} from '@catalog/domain/shared/restaurant-cache-snapshot';
import { REDIS_CACHE, type RedisCache } from '@food-delivery-api/shared-cache';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';

interface CachedRestaurantPage {
  data: RestaurantCacheSnapshot[];
  total: number;
}

/**
 * Served from the CQRS read model — eventually consistent with writes via the
 * projection. Cache-aside keyed by tenant + pagination with a SHORT TTL
 * (list contents shift on every create/update/delete and pagination fans one
 * change out across several page-keys, so a short expiry is the simpler
 * correct trade-off vs. precise invalidation — see `cache-keys.ts`).
 */
@Injectable()
export class ListRestaurantsHandler {
  constructor(
    @Inject(READ_RESTAURANT_REPOSITORY)
    private readonly readRestaurantRepository: ReadRestaurantRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    @Inject(REDIS_CACHE) private readonly cache: RedisCache,
  ) {}

  async execute(pagination: Pagination): Promise<PaginatedResult<Restaurant>> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const key = restaurantListCacheKey(tenantId, pagination);

    const cached = await this.cache.cacheAside<CachedRestaurantPage>(
      key,
      RESTAURANT_LIST_CACHE_TTL_MS,
      async () => {
        const { data, total } = await this.readRestaurantRepository.findAndCount(
          tenantId,
          pagination,
        );
        return { data: data.map(toRestaurantCacheSnapshot), total };
      },
    );

    return {
      data: cached.data.map(fromRestaurantCacheSnapshot),
      total: cached.total,
      page: pagination.page,
      limit: pagination.limit,
    };
  }
}
