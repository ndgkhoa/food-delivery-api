import type { DriverLocationStore } from '@delivery/domain/delivery/driver-location.store';
import type { Location } from '@delivery/domain/delivery/location';
import type { NearbyDriver } from '@delivery/domain/delivery/nearby-driver';
import { REDIS_CLIENT } from '@delivery/infrastructure/redis/redis.tokens';
import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';

function driversKey(tenantId: string): string {
  return `geo:${tenantId}:drivers`;
}

@Injectable()
export class RedisDriverLocationStore implements DriverLocationStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async push(tenantId: string, driverId: string, location: Location): Promise<void> {
    await this.redis.geoadd(driversKey(tenantId), location.lng, location.lat, driverId);
  }

  async remove(tenantId: string, driverId: string): Promise<void> {
    await this.redis.zrem(driversKey(tenantId), driverId);
  }

  async nearby(tenantId: string, origin: Location, radiusMeters: number): Promise<NearbyDriver[]> {
    const raw = (await this.redis.geosearch(
      driversKey(tenantId),
      'FROMLONLAT',
      origin.lng,
      origin.lat,
      'BYRADIUS',
      radiusMeters,
      'm',
      'ASC',
      'WITHDIST',
    )) as [string, string][];

    return raw.map(([driverId, distance]) => ({
      driverId,
      distanceMeters: Number.parseFloat(distance),
    }));
  }

  async onlineDriverIds(tenantId: string): Promise<string[]> {
    return this.redis.zrange(driversKey(tenantId), 0, -1);
  }
}
