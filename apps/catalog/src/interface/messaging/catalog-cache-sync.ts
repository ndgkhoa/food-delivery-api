import type { ReadRestaurantRepository } from '@catalog/domain/read-model/read-restaurant.repository';
import { RESTAURANT_CACHE_TTL_MS, restaurantCacheKey } from '@catalog/domain/shared/cache-keys';
import { toRestaurantCacheSnapshot } from '@catalog/domain/shared/restaurant-cache-snapshot';
import type { RedisCache } from '@food-delivery-api/shared-cache';

/** Restaurant-affecting event types this repo's two projection consumers ever see. */
const WRITE_THROUGH_EVENTS = new Set([
  'RestaurantCreated',
  'RestaurantUpdated',
  'RestaurantRatingChanged',
]);

/**
 * Write-through (or evict) the restaurant cache to match what the read-model
 * projector just committed. Called AFTER the projecting transaction commits —
 * never inside it, since Redis has no transactional tie to Postgres; writing
 * through before a commit could warm the cache with a value a rollback then
 * makes wrong. Re-reads the row from the read model (rather than trusting the
 * event payload) so the cached value is exactly what a fresh DB read would
 * return — correct even though `RestaurantCreated`/`RestaurantUpdated`
 * payloads never carry rating/reviewCount (owned solely by the rating
 * projector) and `RestaurantRatingChanged` never carries name/description.
 *
 * Idempotent: a redelivered event re-reads the (unchanged) current row and
 * writes the same value through again — harmless.
 *
 * BEST-EFFORT + never-throws: the projecting transaction has ALREADY committed
 * before this runs, so a cache-sync failure (a transient read-model read error;
 * Redis errors are already swallowed inside RedisCache) must NOT propagate and
 * re-drive / dead-letter an event whose projection is durable — the next cache
 * miss simply re-loads from the DB. This keeps the cache warm in the common
 * (sequential) case; a concurrent read-miss whose write-back lands AFTER this
 * write-through can still leave a value stale until the TTL backstop expires
 * (bounded eventual consistency, not a hard "never stale" guarantee).
 */
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
      // Read row is gone (e.g. raced with a delete) — never leave a stale hit behind.
      await cache.invalidate(key);
    }
  } catch {
    // Swallow: the projection is already durable; a best-effort cache warm must
    // never fail the message. The next read re-loads from the DB.
  }
}
