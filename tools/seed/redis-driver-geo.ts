import Redis from 'ioredis';
import type { SeedConfig } from './seed-config';

export interface DriverLocationSeed {
  tenantId: string;
  driverId: string;
  lat: number;
  lng: number;
}

/** Mirrors `driversKey()` in `apps/delivery/src/infrastructure/redis/redis-driver-location.store.ts` — a tenant-prefixed GEO sorted set. */
function driversKey(tenantId: string): string {
  return `geo:${tenantId}:drivers`;
}

/**
 * No HTTP endpoint exists for reporting a driver's position on their behalf
 * (a real driver reports it over the delivery service's WebSocket gateway —
 * `apps/delivery/src/interface/ws/delivery.gateway.ts`), so the seeder
 * connects directly to the same Redis (`REDIS_URL`, the shared `core`
 * instance) the delivery service reads from — the same carve-out philosophy
 * as the inventory-stock direct-DB write.
 */
export async function withRedis<T>(
  config: SeedConfig,
  fn: (redis: Redis) => Promise<T>,
): Promise<T> {
  const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
  await redis.connect();
  try {
    return await fn(redis);
  } finally {
    redis.disconnect();
  }
}

/** GEOADD takes longitude first, then latitude — matches `RedisDriverLocationStore.push`. */
export async function pushDriverLocation(redis: Redis, seed: DriverLocationSeed): Promise<void> {
  await redis.geoadd(driversKey(seed.tenantId), seed.lng, seed.lat, seed.driverId);
}

/** A GEO set is a sorted set; ZREM drops the driver from the online roster — matches `RedisDriverLocationStore.remove`. */
export async function removeDriverLocation(
  redis: Redis,
  tenantId: string,
  driverId: string,
): Promise<void> {
  await redis.zrem(driversKey(tenantId), driverId);
}
