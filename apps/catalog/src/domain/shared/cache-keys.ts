import type { Pagination } from '@catalog/domain/shared/pagination';

const RESTAURANT_KEY_PREFIX = 'catalog:restaurant';
const RESTAURANT_LIST_KEY_PREFIX = 'catalog:restaurants';

export function restaurantCacheKey(tenantId: string, id: string): string {
  return `${RESTAURANT_KEY_PREFIX}:${tenantId}:${id}`;
}

export function restaurantListCacheKey(tenantId: string, pagination: Pagination): string {
  return `${RESTAURANT_LIST_KEY_PREFIX}:${tenantId}:list:page=${pagination.page}:limit=${pagination.limit}`;
}

export const RESTAURANT_CACHE_TTL_MS = 30_000;

export const RESTAURANT_LIST_CACHE_TTL_MS = 5_000;
