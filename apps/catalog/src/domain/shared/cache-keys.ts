import type { Pagination } from '@catalog/domain/shared/pagination';

/**
 * Tenant-namespaced Redis key builders for the restaurant cache. Every
 * tenant-scoped key MUST be built here (never inline string concatenation) so
 * a read handler and the read-model projector that write-throughs into the
 * SAME key can never drift apart, and so a cross-tenant key collision is
 * structurally impossible.
 */

const RESTAURANT_KEY_PREFIX = 'catalog:restaurant';
const RESTAURANT_LIST_KEY_PREFIX = 'catalog:restaurants';

/** Single-restaurant cache-aside/write-through key: `catalog:restaurant:{tenantId}:{id}`. */
export function restaurantCacheKey(tenantId: string, id: string): string {
  return `${RESTAURANT_KEY_PREFIX}:${tenantId}:${id}`;
}

/**
 * List-page cache-aside key, keyed by tenant + pagination:
 * `catalog:restaurants:{tenantId}:list:page={page}:limit={limit}`.
 */
export function restaurantListCacheKey(tenantId: string, pagination: Pagination): string {
  return `${RESTAURANT_LIST_KEY_PREFIX}:${tenantId}:list:page=${pagination.page}:limit=${pagination.limit}`;
}

/**
 * Per-restaurant entries are the primary cache win (read far more often than
 * written). The projector's write-through keeps the entry fresh in the common
 * case, but a cache-aside read-miss whose write-back lands AFTER a concurrent
 * write-through (or a delete) leaves the entry stale — the TTL is the backstop
 * that self-heals that race, so it's kept short (bounded eventual consistency).
 * A version-guarded write would eliminate the race but the read-model rating
 * update doesn't bump a version to compare, so the TTL is the pragmatic choice.
 */
export const RESTAURANT_CACHE_TTL_MS = 30_000;

/**
 * List pages are cheaper to keep short-lived than to invalidate precisely:
 * an update could change name/isActive/rating on ANY row of ANY cached page,
 * and pagination means a single change can affect several page-keys at once.
 * Rather than pattern-DEL every list key on every write (extra Redis round
 * trip on the hot write path for a low-traffic query), list pages simply
 * expire fast — the read-model projector deliberately does NOT invalidate
 * list keys; `RedisCache.invalidatePattern` remains available (and tested)
 * for a future call site that needs precise list invalidation.
 */
export const RESTAURANT_LIST_CACHE_TTL_MS = 5_000;
