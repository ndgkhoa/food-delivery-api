import { Restaurant } from '@catalog/domain/restaurant/restaurant';

/**
 * JSON-safe snapshot of a `Restaurant` for the cache. `Restaurant` is a
 * plain class with getters over a private `props` field — round-tripping an
 * instance through `JSON.stringify`/`JSON.parse` directly would serialise
 * `{ props: {...} }` and lose every getter, so callers convert to/from this
 * shape at the cache boundary instead of caching the domain object itself.
 */
export interface RestaurantCacheSnapshot {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  rating: number;
  reviewCount: number;
  /**
   * Optimistic-lock version, mirrored from the read model row. Not a schema
   * rename (an additive field), so the cache key isn't bumped: a value cached
   * before this field existed simply lacks it, `fromRestaurantCacheSnapshot`
   * falls back to `Restaurant`'s `?? 1` default for that single entry until it
   * naturally expires off the short (30s) TTL — bounded, self-healing, and
   * consistent with this cache's existing "TTL is the staleness backstop"
   * design (see `cache-keys.ts`).
   */
  version: number;
}

export function toRestaurantCacheSnapshot(restaurant: Restaurant): RestaurantCacheSnapshot {
  return {
    id: restaurant.id,
    tenantId: restaurant.tenantId,
    name: restaurant.name,
    description: restaurant.description,
    isActive: restaurant.isActive,
    createdAt: restaurant.createdAt.toISOString(),
    updatedAt: restaurant.updatedAt.toISOString(),
    rating: restaurant.rating,
    reviewCount: restaurant.reviewCount,
    version: restaurant.version,
  };
}

export function fromRestaurantCacheSnapshot(snapshot: RestaurantCacheSnapshot): Restaurant {
  return Restaurant.reconstitute({
    id: snapshot.id,
    tenantId: snapshot.tenantId,
    name: snapshot.name,
    description: snapshot.description,
    isActive: snapshot.isActive,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    deletedAt: null,
    rating: snapshot.rating,
    reviewCount: snapshot.reviewCount,
    version: snapshot.version,
  });
}
