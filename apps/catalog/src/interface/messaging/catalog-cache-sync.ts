import type { ReadRestaurantRepository } from '@catalog/domain/read-model/read-restaurant.repository';
import { RESTAURANT_CACHE_TTL_MS, restaurantCacheKey } from '@catalog/domain/shared/cache-keys';
import { toRestaurantCacheSnapshot } from '@catalog/domain/shared/restaurant-cache-snapshot';
import type { RedisCache } from '@food-delivery-api/shared-cache';

const WRITE_THROUGH_EVENTS = new Set([
  'RestaurantCreated',
  'RestaurantUpdated',
  'RestaurantRatingChanged',
]);

export async function syncRestaurantCache(
  eventType: string,
  aggregateId: string,
  tenantId: string,
  cache: RedisCache,
  readRestaurants: ReadRestaurantRepository,
): Promise<void> {
  const key = restaurantCacheKey(tenantId, aggregateId);
  try {
    if (eventType === 'RestaurantDeleted') {
      await cache.invalidate(key);
      return;
    }
    if (!WRITE_THROUGH_EVENTS.has(eventType)) {
      return;
    }
    const restaurant = await readRestaurants.findById(aggregateId, tenantId);
    if (restaurant) {
      await cache.writeThrough(key, toRestaurantCacheSnapshot(restaurant), RESTAURANT_CACHE_TTL_MS);
    } else {
      await cache.invalidate(key);
    }
  } catch {
    // Swallow: the projection is already durable; a best-effort cache warm must
    // never fail the message. The next read re-loads from the DB.
  }
}
