import type { Assignment } from '@delivery/domain/delivery/assignment';
import type { AssignmentClaim, AssignmentStore } from '@delivery/domain/delivery/assignment.store';
import { REDIS_CLIENT } from '@delivery/infrastructure/redis/redis.tokens';
import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';

function assignHashKey(tenantId: string): string {
  return `assign:${tenantId}`;
}
function busyKey(tenantId: string): string {
  return `assign:${tenantId}:busy`;
}
function driverOrdersPrefix(tenantId: string): string {
  return `assign:${tenantId}:driver:`;
}

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

const RELEASE_ORDER = `
local driver = redis.call('HGET', KEYS[1], ARGV[1])
if not driver then return 0 end
redis.call('HDEL', KEYS[1], ARGV[1])
redis.call('SREM', ARGV[2] .. driver, ARGV[1])
if redis.call('SCARD', ARGV[2] .. driver) == 0 then
  redis.call('SREM', KEYS[2], driver)
end
return 1`;

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
