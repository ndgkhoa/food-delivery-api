import type { Assignment } from '@delivery/domain/delivery/assignment';
import type { AssignmentStore } from '@delivery/domain/delivery/assignment.store';
import { REDIS_CLIENT } from '@delivery/infrastructure/redis/redis.tokens';
import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';

/** Hash of orderId → driverId (the authoritative one-driver-per-order record). */
function assignHashKey(tenantId: string): string {
  return `assign:${tenantId}`;
}
/** Set of driver ids that currently hold an assignment (the busy roster). */
function busyKey(tenantId: string): string {
  return `assign:${tenantId}:busy`;
}
/** Set of order ids assigned to one driver (reverse index for location fan-out). */
function driverOrdersKey(tenantId: string, driverId: string): string {
  return `assign:${tenantId}:driver:${driverId}`;
}

/**
 * Redis adapter for order→driver assignments (ioredis). The core record is a
 * per-tenant hash written with `HSETNX`, which sets a field only if absent — so
 * a redelivered or racing `order.events` can never overwrite the driver already
 * assigned to an order (idempotent one-driver-per-order). Two auxiliary sets are
 * maintained on the winning write: the busy roster (drivers with any assignment)
 * and a per-driver order index (which rooms a driver's location fans out to).
 * All keys are tenant-prefixed.
 *
 * A completed order is not yet unassigned here, so a driver stays "busy" for the
 * lifetime of the slice — an unassign-on-delivery path is future work.
 */
@Injectable()
export class RedisAssignmentStore implements AssignmentStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async assign(tenantId: string, orderId: string, driverId: string): Promise<Assignment> {
    const created = await this.redis.hsetnx(assignHashKey(tenantId), orderId, driverId);
    if (created === 1) {
      await Promise.all([
        this.redis.sadd(busyKey(tenantId), driverId),
        this.redis.sadd(driverOrdersKey(tenantId, driverId), orderId),
      ]);
      return { orderId, driverId };
    }
    // Lost the race (or redelivery): return whoever actually holds the order.
    const winner = await this.redis.hget(assignHashKey(tenantId), orderId);
    return { orderId, driverId: winner ?? driverId };
  }

  async get(tenantId: string, orderId: string): Promise<Assignment | undefined> {
    const driverId = await this.redis.hget(assignHashKey(tenantId), orderId);
    return driverId ? { orderId, driverId } : undefined;
  }

  async busyDriverIds(tenantId: string): Promise<string[]> {
    return this.redis.smembers(busyKey(tenantId));
  }

  async ordersForDriver(tenantId: string, driverId: string): Promise<string[]> {
    return this.redis.smembers(driverOrdersKey(tenantId, driverId));
  }
}
