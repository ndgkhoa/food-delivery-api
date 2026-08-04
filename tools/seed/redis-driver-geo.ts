import Redis from 'ioredis';
import type { SeedConfig } from './seed-config';

export interface DriverLocationSeed {
  tenantId: string;
  driverId: string;
  lat: number;
  lng: number;
}

function driversKey(tenantId: string): string {
  return `geo:${tenantId}:drivers`;
}

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

export async function pushDriverLocation(redis: Redis, seed: DriverLocationSeed): Promise<void> {
  await redis.geoadd(driversKey(seed.tenantId), seed.lng, seed.lat, seed.driverId);
}

export async function removeDriverLocation(
  redis: Redis,
  tenantId: string,
  driverId: string,
): Promise<void> {
  await redis.zrem(driversKey(tenantId), driverId);
}
