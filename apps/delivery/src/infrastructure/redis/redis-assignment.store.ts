import type { Assignment } from '@delivery/domain/delivery/assignment';
import type { AssignmentClaim, AssignmentStore } from '@delivery/domain/delivery/assignment.store';
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
/** Prefix for the per-driver order index (`<prefix><driverId>`), used by the Lua scripts + fan-out. */
function driverOrdersPrefix(tenantId: string): string {
  return `assign:${tenantId}:driver:`;
}

/**
 * Claim the first non-busy candidate atomically. Redis runs the whole script
 * single-threaded, so two orders confirmed concurrently can never both bind the
 * same free driver: whichever script runs first adds the driver to the busy set,
 * and the second sees it busy and falls through to the next candidate.
 *   KEYS[1]=assign hash  KEYS[2]=busy set
 *   ARGV[1]=orderId  ARGV[2]=driver-orders key prefix  ARGV[3..]=candidate ids
 *   returns {driverId, '1'|'0'} — '0' = pre-existing incumbent, '1' = newly bound; nil = none free.
 */
const CLAIM_FIRST_FREE = `
local incumbent = redis.call('HGET', KEYS[1], ARGV[1])
if incumbent then return {incumbent, '0'} end
for i = 3, #ARGV do
  local driver = ARGV[i]
  if redis.call('SISMEMBER', KEYS[2], driver) == 0 then
    redis.call('HSET', KEYS[1], ARGV[1], driver)
    redis.call('SADD', KEYS[2], driver)
    redis.call('SADD', ARGV[2] .. driver, ARGV[1])
    return {driver, '1'}
  end
end
return nil`;

/**
 * Release an order's assignment: drop the binding, remove the order from the
 * driver's index, and clear the driver's busy flag only when it holds no other
 * orders — all atomically.
 *   KEYS[1]=assign hash  KEYS[2]=busy set  ARGV[1]=orderId  ARGV[2]=driver-orders prefix
 */
const RELEASE_ORDER = `
local driver = redis.call('HGET', KEYS[1], ARGV[1])
if not driver then return 0 end
redis.call('HDEL', KEYS[1], ARGV[1])
redis.call('SREM', ARGV[2] .. driver, ARGV[1])
if redis.call('SCARD', ARGV[2] .. driver) == 0 then
  redis.call('SREM', KEYS[2], driver)
end
return 1`;

/**
 * Redis adapter for order→driver assignments (ioredis). Every state change goes
 * through a Lua script so the one-driver-per-order AND one-order-per-driver
 * invariants hold atomically even under concurrent `order.events`. Keys are
 * tenant-prefixed, so assignments never cross tenant boundaries.
 */
@Injectable()
export class RedisAssignmentStore implements AssignmentStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async assign(
    tenantId: string,
    orderId: string,
    candidateDriverIdsNearestFirst: string[],
  ): Promise<AssignmentClaim | undefined> {
    const result = (await this.redis.eval(
      CLAIM_FIRST_FREE,
      2,
      assignHashKey(tenantId),
      busyKey(tenantId),
      orderId,
      driverOrdersPrefix(tenantId),
      ...candidateDriverIdsNearestFirst,
    )) as [string, string] | null;
    if (!result) {
      return undefined;
    }
    return { assignment: { orderId, driverId: result[0] }, created: result[1] === '1' };
  }

  async unassign(tenantId: string, orderId: string): Promise<void> {
    await this.redis.eval(
      RELEASE_ORDER,
      2,
      assignHashKey(tenantId),
      busyKey(tenantId),
      orderId,
      driverOrdersPrefix(tenantId),
    );
  }

  async get(tenantId: string, orderId: string): Promise<Assignment | undefined> {
    const driverId = await this.redis.hget(assignHashKey(tenantId), orderId);
    return driverId ? { orderId, driverId } : undefined;
  }

  async ordersForDriver(tenantId: string, driverId: string): Promise<string[]> {
    return this.redis.smembers(`${driverOrdersPrefix(tenantId)}${driverId}`);
  }
}
