import type { DriverLocationStore } from '@delivery/domain/delivery/driver-location.store';
import type { Location } from '@delivery/domain/delivery/location';
import type { NearbyDriver } from '@delivery/domain/delivery/nearby-driver';
import { REDIS_CLIENT } from '@delivery/infrastructure/redis/redis.tokens';
import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';

/** Tenant-prefixed GEO set key — driver positions never cross tenant boundaries. */
function driversKey(tenantId: string): string {
  return `geo:${tenantId}:drivers`;
}

/**
 * Redis GEO adapter for live driver positions (ioredis). A driver id is a member
 * of a per-tenant sorted set whose score encodes its lng/lat geohash, so a
 * position upsert is one `GEOADD` and a radius lookup is one `GEOSEARCH`. The
 * key is tenant-prefixed, so `nearby`/`onlineDriverIds` can only ever see the
 * caller's own drivers.
 */
@Injectable()
export class RedisDriverLocationStore implements DriverLocationStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async push(tenantId: string, driverId: string, location: Location): Promise<void> {
    // GEOADD takes longitude first, then latitude.
    await this.redis.geoadd(driversKey(tenantId), location.lng, location.lat, driverId);
  }

  async nearby(tenantId: string, origin: Location, radiusMeters: number): Promise<NearbyDriver[]> {
    // WITHDIST returns each hit as [member, distanceString]; ASC = nearest first.
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
    // A GEO set is a sorted set, so ZRANGE lists every driver currently reporting.
    return this.redis.zrange(driversKey(tenantId), 0, -1);
  }
}
