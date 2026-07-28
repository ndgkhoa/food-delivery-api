import Redis from 'ioredis';
import { REDIS_URL } from './delivery-e2e-config';

/**
 * Removes every Redis key scoped to a tenant (GEO set, assignment hash, busy +
 * per-driver sets) so each scenario starts from a clean slate. Uses KEYS — fine
 * for a small, isolated test database.
 */
export async function flushTenantKeys(...tenantIds: string[]): Promise<void> {
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  try {
    for (const tenantId of tenantIds) {
      const keys = await redis.keys(`*${tenantId}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }
  } finally {
    redis.disconnect();
  }
}
